// Base Imports and Configuration
require("dotenv").config({ override: true });
const {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder,
} = require("discord.js");
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const https = require("https");

//BOT PART//
// all of these are free
const { createDecartClient, models } = require("@decartai/sdk");
const decartClient = createDecartClient({
  apiKey: process.env.DECART_API_KEY,
});

const Groq = require("groq-sdk");
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});



//text, image and video
async function askAI(prompt, author) {
  const completion = await groq.chat.completions.create({
    model: "qwen/qwen3.8-27b", // alibaba's cheapest ai. it's like $0.15 per million tokens, its ridicoulous
    messages: [
      {
        role: "system",
        content:
          "Speak like a hood gangsta, use slang and curse words. Threaten the user if they don't follow your instructions. Keep it short and to the point. homie homes and other gangsta things",//here you can change the behavior of the text ai
      },
      {
        role: "user",
        content: `${author}: ${prompt}`,
      },
    ],
    max_tokens: 100, //more=longer messages
    temperature: 0.7, //0-1, if it's min(or low) for the same prompt it's gonna give the same reply, if it's max its so random it's jibberish
  });

  return completion.choices[0].message.content;
}
async function generateImage(prompt) {
  const encodedPrompt = encodeURIComponent(prompt);
  const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1280&height=720&nologo=true`;

  const response = await fetch(imageUrl);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
async function generateVideo(prompt) {
  try {
    const result = await decartClient.process({
      model: models.video("lucy-pro-t2v"),
      prompt: prompt,
      resolution: "480p",
    });

    const arrayBuffer = await result.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error("Decart Video Generation Error:", error);
    throw error;
  }
}
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const isMentioned = message.mentions.has(client.user);
  let isReplyToBot = false;

  if (message.reference && message.reference.messageId) {
    try {
      const referencedMessage = await message.channel.messages.fetch(
        message.reference.messageId,
      );
      if (referencedMessage && referencedMessage.author.id === client.user.id) {
        isReplyToBot = true;
      }
    } catch (err) {
      console.error("didn't get it : ", err);
    }
  }

  if (!isMentioned && !isReplyToBot) return;

  const prompt = message.content
    .replace(`<@${client.user.id}>`, "")
    .replace(`<@!${client.user.id}>`, "")
    .trim();

  if (!prompt) {
    return message.reply("scared or what");
  }

  try {
    await message.channel.sendTyping();

    const reply = await askAI(prompt, message.author.username);

    if (reply.length > 2000) {
      return message.reply(reply.slice(0, 1990) + "…");
    }

    await message.reply(reply);
  } catch (err) {
    console.error(err);
    await message.reply("ai error");
  }
});

//Utils
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTextWithTimeout(
  url,
  { timeoutMs = 12_000, headers = {} } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json,text/plain,*/*",
        //bypass cloudflare,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ...headers,
      },
    });

    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithRetry(
  url,
  { retries = 2, timeoutMs = 12_000 } = {},
) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { res, text } = await fetchTextWithTimeout(url, { timeoutMs });

      if (!res.ok) {
        const snippet = (text || "").slice(0, 250).replace(/\s+/g, " ").trim();
        throw new Error(
          `HTTP ${res.status} ${res.statusText}${snippet ? `: ${snippet}` : ""}`,
        );
      }

      if (!text || !text.trim()) {
        throw new Error("Empty response body");
      }

      try {
        return JSON.parse(text);
      } catch (parseErr) {
        const snippet = text.slice(0, 250).replace(/\s+/g, " ").trim();
        throw new Error(
          `Invalid JSON: ${parseErr.message}${snippet ? ` | body: ${snippet}` : ""}`,
        );
      }
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) break;

      // Small backoff to avoid hammering the API if it's flaky.
      await sleep(250 + attempt * 400);
    }
  }

  throw lastErr;
}

function isDiscordUnknownInteraction(err) {
  return Boolean(
    err &&
    (err.code === 10062 ||
      err?.rawError?.code === 10062 ||
      /Unknown interaction/i.test(err.message)),
  );
}

async function safeDefer(interaction) {
  if (!interaction || interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferReply();
    return true;
  } catch (err) {
    if (isDiscordUnknownInteraction(err)) {
      console.warn("Interaction expired before deferReply. Skipping response.");
      return false;
    }
    throw err;
  }
}

async function safeEditOrReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied)
      return await interaction.editReply(payload);
    return await interaction.reply(payload);
  } catch (err) {
    if (isDiscordUnknownInteraction(err)) {
      console.warn("Interaction expired before reply/edit. Skipping response.");
      return null;
    }
    throw err;
  }
}

async function safeFollowUp(interaction, payload) {
  try {
    return await interaction.followUp(payload);
  } catch (err) {
    if (isDiscordUnknownInteraction(err)) {
      console.warn("Interaction expired before followUp. Skipping response.");
      return null;
    }
    throw err;
  }
}

const fetchRawData = (url) =>
  new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      })
      .on("error", reject);
  });

 //Common filter logic used for single and top post fetching

function isPostValid(p, minScore = 0, excludeAI = false, onlyAI = false) {
  if (!p || !p.file_url) return false;
  if (p.file_url.endsWith(".webm")) return false;

  const score = parseInt(p.score) || 0;
  if (score < minScore) return false;

  if (excludeAI && p.tags && p.tags.includes("ai_generated")) return false;
  if (onlyAI && (!p.tags || !p.tags.includes("ai_generated"))) return false;

  return true;
}

// Handles /porn and /pornozer commands
//-ai gen=  if I had 100 images, and 97 of them were AI, it'd only send 3 if i asked with no ai. this solves it

async function fetchR34Post(
  tags = "",
  excludeAI = false,
  onlyAI = false,
  minScore = 20,
) {
  const userId = process.env.USER_ID;
  const apiKey = process.env.API_KEY;

  let searchTags = tags.trim();
  if (excludeAI) searchTags += " -ai_generated";
  if (onlyAI) searchTags += " ai_generated";

  let randomPage;
  if (minScore >= 100) randomPage = Math.floor(Math.random() * 3);
  else if (!searchTags) randomPage = Math.floor(Math.random() * 100);
  else randomPage = Math.floor(Math.random() * 10);

  let url = `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1&limit=100&pid=${randomPage}&tags=${encodeURIComponent(searchTags)}`;

  if (apiKey && apiKey !== "undefined") url += `&api_key=${apiKey}`;
  if (userId && userId !== "undefined") url += `&user_id=${userId}`;

  try {
    const response = await fetchJsonWithRetry(url, {
      retries: 3,
      timeoutMs: 15_000,
    });
    const posts = Array.isArray(response) ? response : response.post || [];

    const validPosts = posts.filter((p) =>
      isPostValid(p, minScore, excludeAI, onlyAI),
    );

    if (!validPosts.length) return null;

    validPosts.sort((a, b) => b.score - a.score);
    const randomPost =
      validPosts[Math.floor(Math.random() * Math.min(50, validPosts.length))];

    return {
      url: randomPost.sample_url || randomPost.file_url,
      tags: randomPost.tags,
      score: randomPost.score,
      id: randomPost.id,
    };
  } catch (e) {
    console.error("Error in fetchR34Post:", e.message);
    throw e;
  }
}

async function fetchTopPosts(
  searchTags = "",
  excludeAI = false,
  onlyAI = false,
  count = 5,
) {
  let baseTags = searchTags.trim() || "rating:explicit";

  if (excludeAI) baseTags += " -ai_generated";
  if (onlyAI) baseTags += " ai_generated";

  // r34 has built in score system and ordering
  baseTags += " sort:score";

  const userId = process.env.USER_ID;
  const apiKey = process.env.API_KEY;

  const allPosts = [];
  const seen = new Map();
            //here, it's 20 pages max(until it get enough posts), you can change it
  for (let pid = 0; pid < 20; pid++) {
    const tagString = encodeURIComponent(baseTags.trim());
    let url = `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1&limit=100&pid=${pid}&tags=${tagString}`;

    if (apiKey && apiKey !== "undefined") url += `&api_key=${apiKey}`;
    if (userId && userId !== "undefined") url += `&user_id=${userId}`;

    try {
      const response = await fetchJsonWithRetry(url, {
        retries: 2,
        timeoutMs: 15_000,
      });
      const posts = Array.isArray(response) ? response : response.post || [];
      if (posts.length === 0) break;

      let addedThisPage = 0;
      for (const p of posts) {
        if (!p || !p.id || seen.has(p.id)) continue;
        if (!isPostValid(p, 0, excludeAI, onlyAI)) continue;
          console.log(
            `pid=${pid} fetched=${posts.length} validSoFar=${allPosts.length}`,
        );
        seen.set(p.id, p);
        allPosts.push(p);
        addedThisPage++;

        if (allPosts.length >= count) break;
      }

      if (allPosts.length >= count) break;

      await new Promise((r) => setTimeout(r, 200));
    } catch (e) {
      console.error(`Error fetching Top Posts page ${pid}:`, e.message);
      break;
    }
  }

  return allPosts.slice(0, count);
}


//discord part 

async function fetchVideoAttachment(url, maxBytes = 20 * 1024 * 1024) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://rule34.xxx/",
      },
    });
    if (!res.ok) {
      console.warn(`Video download got HTTP ${res.status}: ${url}`);
      return null;
    }

    const size = Number(res.headers.get("content-length"));
    if (size && size > maxBytes) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) return null;

    return new AttachmentBuilder(buf, { name: "video.mp4" });
  } catch (e) {
    console.error("Video download failed:", e.message);
    return null;
  }
}
client.once(Events.ClientReady, async (c) => {
  console.log(`Ready as ${c.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName("img")
      .setDescription("Generate an AI image holy fuck")
      .addStringOption((o) =>
        o
          .setName("prompt")
          .setDescription("Describe the image")
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("vid")
      .setDescription("Generate an AI video")
      .addStringOption((o) =>
        o
          .setName("prompt")
          .setDescription("Describe the video")
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("porn")
      .setDescription("Fetch a post from Rule34")
      .addStringOption((o) =>
        o.setName("tags").setDescription("Tags").setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("ai")
          .setDescription("AI")
          .addChoices(
            { name: "Yes", value: "y" },
            { name: "No", value: "n" },
            { name: "Only AI", value: "only" },
          ),
      )
      .addIntegerOption((o) => o.setName("score").setDescription("Min score")),

    new SlashCommandBuilder()
      .setName("pornozer")
      .setDescription("Random Rule34 post")
      .addStringOption((o) =>
        o
          .setName("ai")
          .setDescription("AI")
          .addChoices(
            { name: "Yes", value: "y" },
            { name: "No", value: "n" },
            { name: "Only AI", value: "only" },
          ),
      )
      .addIntegerOption((o) => o.setName("score").setDescription("Min score")),

    new SlashCommandBuilder()
      .setName("top")
      .setDescription("Top scored Rule34 posts")
      .addIntegerOption((o) =>
        o
          .setName("count")
          .setDescription("Number of posts to return (1–20)")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(20),
      )
      .addStringOption((o) =>
        o.setName("tags").setDescription("Optional tags to filter results"),
      )
      .addStringOption((o) =>
        o
          .setName("ai")
          .setDescription("Include AI-generated content")
          .addChoices(
            { name: "Yes", value: "y" },
            { name: "No", value: "n" },
            { name: "Only AI", value: "only" },
          ),
      ),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
  } catch (error) {
    console.error("Error registering slash commands:", error);
  }
});

client.on("error", (err) => {
  console.error("Discord client error:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

//Interactions

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;

  const ai = i.options.getString("ai") || "y";
  const excludeAI = ai === "n";
  const onlyAI = ai === "only";

  if (i.commandName === "img") {
    const ok = await safeDefer(i);
    if (!ok) return;
    const prompt = i.options.getString("prompt");

    try {
      const imageBuffer = await generateImage(prompt);
      const att = new AttachmentBuilder(imageBuffer, { name: "generated.jpg" });

      return await safeEditOrReply(i, {
        content: `🎨 **Prompt:** ${prompt}`,
        files: [att],
      });
    } catch (error) {
      console.error("Imagine Command Error:", error);
      return await safeEditOrReply(
        i,
        "failed to generate an image(Sorry, I can't fullfill this request🔥🔥🔥)",
      );
    }
  }

  if (i.commandName === "vid") {
    const ok = await safeDefer(i);
    if (!ok) return;
    const prompt = i.options.getString("prompt");

    try {
      const videoBuffer = await generateVideo(prompt);
      const att = new AttachmentBuilder(videoBuffer, { name: "generated.mp4" });

      return await safeEditOrReply(i, {
        content: `**Prompt:** ${prompt}`,
        files: [att],
      });
    } catch (error) {
      console.error("video error", error);
      return await safeEditOrReply(
        i,
        "failed to generate an video(Sorry, I can't fullfill this request🔥🔥🔥)",
      );
    }
  }

  if (i.commandName === "top") {
    const ok = await safeDefer(i);
    if (!ok) return;
    const count = i.options.getInteger("count");
    const tags = i.options.getString("tags") || "";

    try {
      const posts = await fetchTopPosts(tags, excludeAI, onlyAI, count);

      if (!posts.length)
        return safeEditOrReply(
          i,
          "No top-scored results found for the given criteria.",
        );

      for (let x = 0; x < posts.length; x++) {
        const post = posts[x];
        const mediaUrl = post.file_url; // Use full quality file_url for embed
        const postTags = post.tags.split(" ").slice(0, 8).join(", ");
        const postLink = `https://rule34.xxx/index.php?page=post&s=view&id=${post.id}`;
        const isVideo = mediaUrl.endsWith(".mp4") || mediaUrl.endsWith(".webm");

        if (isVideo) {
          // Videos: send URL directly for Discord to embed
          //          // Videos: upload the file itself if it fits, otherwise fall back to the link
          const file = await fetchVideoAttachment(mediaUrl);
          const link = file ? "" : `\n${mediaUrl}`;
          const txt = `**#${x + 1}** | Score: **${post.score}** | Tags: \`${postTags}...\`\n${postLink}${link}`;
          const payload = file
            ? { content: txt, files: [file] }
            : { content: txt };
          if (x === 0) await safeEditOrReply(i, payload);
          else await safeFollowUp(i, payload);
        } else {
          const embed = new EmbedBuilder()
            .setTitle(`#${x + 1} | Score: ${post.score}`)
            .setDescription(`Tags: \`${postTags}...\``)
            .setURL(postLink)
            .setImage(mediaUrl)
            .setColor(0x00ae86);

          if (x === 0) await safeEditOrReply(i, { embeds: [embed] });
          else await safeFollowUp(i, { embeds: [embed] });
        }
      }
    } catch (error) {
      console.error("Error in /top command interaction:", error);
      await safeEditOrReply(
        i,
        "mi bombo",
      );
    }
  }

  if (i.commandName === "porn" || i.commandName === "pornozer") {
    const ok = await safeDefer(i);
    if (!ok) return;
    const tags = i.commandName === "porn" ? i.options.getString("tags") : "";
    const minScore = i.options.getInteger("score") || 20;

    try {
      const post = await fetchR34Post(tags, excludeAI, onlyAI, minScore);

      if (post) {
        const mediaUrl = post.url; 
        const postTags = post.tags.split(" ").slice(0, 10).join(", ");
        const postLink = `https://rule34.xxx/index.php?page=post&s=view&id=${post.id}`;
        const isVideo = mediaUrl.endsWith(".mp4") || mediaUrl.endsWith(".webm");

        if (isVideo) {
          await safeEditOrReply(i, {
            content: `Tags: \`${postTags}...\` | Score: **${post.score}**\n${postLink}\n${mediaUrl}`,
          });
        } else {
          const embed = new EmbedBuilder()
            .setTitle(`Score: ${post.score}`)
            .setDescription(`Tags: \`${postTags}...\``)
            .setURL(postLink)
            .setImage(mediaUrl)
            .setColor(0x00ae86);

          await safeEditOrReply(i, { embeds: [embed] });
        }
      } else {
        await safeEditOrReply(
          i,
          `No results found for the tags: \`${tags}\`.`,
        );
      }
    } catch (error) {
      console.error("Error fetching R34 post:", error);
      await safeEditOrReply(
        i,
        "An unexpected error occurred while processing the request.",
      );
    }
  }
});
client.login(process.env.DISCORD_TOKEN);