# Abstract

it's a discord bot with the main purpouse of fetching r34 posts and sending it as a message. Other than that, it can chat, create images and videos.

## Requirements

Node.js 18 or newer (the bot uses the built-in `fetch` API).
api from groq(ai chat), decart(video) 

## Setup
1. Clone the repository and install dependencies:

   ```sh
   git clone https://github.com/ita-Kyi/r34bot.git
   cd r34bot
   npm install
   ```

2. Create a `.env` file in the project root:

   ```dotenv
   DISCORD_TOKEN=your_discord_bot_token
   GROQ_API_KEY=your_groq_api_key
   DECART_API_KEY=your_decart_api_key

   # Optional Rule34 API credentials:
   API_KEY=your_rule34_api_key
   USER_ID=your_rule34_user_id
   ```

3. In the Discord Developer Portal, enable the **Message Content Intent** for the bot. Invite the bot with the `bot` and `applications.commands` OAuth scopes. It needs permission to view channels, read message history, send messages, embed links, and attach files. Make sure slash commands are available in the server where you plan to use the bot.

4. Start the bot:

   ```sh
   npm start
   ```

   `npm run dev` currently runs the same command. On startup, the bot registers its slash commands globally; Discord command updates may take time to appear.

## Commands and behavior

| Command | Options | What it does |
| --- | --- | --- |
| `/img` | `prompt` (required) | Generates an image from the prompt using Pollinations and posts it as an attachment. |
| `/vid` | `prompt` (required) | Generates a 480p video using Decart's `lucy-pro-t2v` model and posts it as an attachment. |
| `/porn` | `tags` (required), `ai` (optional), `score` (optional) | Finds a Rule34 post matching the tags. The minimum score defaults to 20. |
| `/pornozer` | `ai` (optional), `score` (optional) | Finds a random Rule34 post, with the same AI and minimum-score filters as `/porn`. |
| `/top` | `count` (1–20, required), `tags` (optional), `ai` (optional) | Returns up to the requested number of high-scoring Rule34 posts. With no tags it searches explicit-rated posts. |

For `/porn`, `/pornozer`, and `/top`, the `ai` option works as follows:

- **Yes** (the default): do not filter by AI-generated tag.
- **No**: exclude posts tagged `ai_generated`.
- **Only AI**: return only posts tagged `ai_generated`.

The optional `score` setting applies to `/porn` and `/pornozer`, not `/top`. Images are shown as embeds. Some video results are linked directly; `/top` also attempts to attach video files up to 20 MiB. Sadly if a video is longer than that, it will only send the link and not the imbeded video :_/

## Functions in `index.js`

if you're interested in the code: 

| Function or handler | Purpose |
| --- | --- |
| `askAI(prompt, author)` | Sends a user's message and author name to Groq and returns the generated chat response. |
| `generateImage(prompt)` | Requests an image from Pollinations and returns its bytes. |
| `generateVideo(prompt)` | Requests a video from Decart and returns its bytes; logs and rethrows errors. |
| `MessageCreate` handler | Ignores bot messages; handles messages mentioning or replying to the bot; calls `askAI` and replies in the channel. |
| `sleep(ms)` | Provides a promise-based delay used between API retries. |
| `fetchTextWithTimeout(url, options)` | Fetches a URL with a timeout and returns the response and response text. |
| `fetchJsonWithRetry(url, options)` | Fetches JSON with retries, timeout handling, and useful errors for HTTP, empty-body, and invalid-JSON responses. |
| `isDiscordUnknownInteraction(err)` | Detects Discord's expired/unknown interaction error. |
| `safeDefer(interaction)` | Defers a command response and handles interactions that expired before deferral. |
| `safeEditOrReply(interaction, payload)` | Edits a deferred/replied response or sends the initial reply, handling expired interactions. |
| `safeFollowUp(interaction, payload)` | Sends a follow-up response and handles expired interactions. |
| `fetchRawData(url)` | Legacy HTTPS text-fetch helper; retained for compatibility and not used by the current command flow. |
| `isPostValid(post, minScore, excludeAI, onlyAI)` | Filters Rule34 posts by file URL, minimum score, and AI-generated tag. |
| `fetchR34Post(tags, excludeAI, onlyAI, minScore)` | Queries Rule34 and selects a random valid post for `/porn` or `/pornozer`. |
| `fetchTopPosts(tags, excludeAI, onlyAI, count)` | Pages through Rule34 results, removes duplicates, and collects posts for `/top`. |
| `fetchVideoAttachment(url, maxBytes)` | Downloads a video for `/top` if it fits the size limit; otherwise the caller can fall back to a link. |
| `ClientReady` handler | Logs in as ready and registers the slash commands with Discord. |
| Discord `error` handler | Logs Discord client errors. |
| `unhandledRejection` handler | Logs unhandled promise rejections. |
| `uncaughtException` handler | Logs uncaught exceptions. |
| `InteractionCreate` handler | Dispatches `/img`, `/vid`, `/porn`, `/pornozer`, and `/top`; defers long-running replies and formats results. |

# r34_bot
A discord bot that uses r34 API to fetch posts. Other than that it can talk , create videos and image (free api my beloved)
