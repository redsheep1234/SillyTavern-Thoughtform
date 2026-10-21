# Scene Video

SillyTavern extension that turns the messages you select in the current chat into a shot list, then a video. It installs from SillyTavern's **Install extension** box. There is no server plugin.

The film icon next to Send, the extensions menu item **Scene video**, the per-message film icon, and `/scenevideo` all open the same panel.

## Install

1. In SillyTavern, open **Extensions** and choose **Install extension**.
2. Paste the git URL of this project. The repository root already has `manifest.json`, `index.js`, `style.css`, and `settings.html`.
3. Enable the extension and reload the chat.

Requires SillyTavern 1.13.0 or newer. The shot list can use the model you already connected in SillyTavern, so that step does not need a second key.

## Make a video

1. Open the panel and tick the messages that belong in the scene. **All**, **None**, **Last N**, and **From / to** are there for long chats.
2. Pick a style and a theme, and add any extra or negative prompt.
3. Choose a provider and a quality preset. The footer shows an estimated cost before you send.
4. **Write shot list**. Edit every prompt, camera line, and duration. **Use local split** does the same split without a model and quotes the chat, so you can see that it is not an LLM pass.
5. **Generate video**. Clips are stitched in the browser. One clip skips the stitch. Download the result, attach it to the last selected message, or attach it as a new message.

Closing the panel does not cancel a job. **Cancel** does. If stitching fails, the finished clips can still be downloaded one by one.

Reference stills stay in the current page session. They are scaled to a JPEG around 1024px and are not written into settings.

## Quality presets

| Preset | Picture | Default host |
| --- | --- | --- |
| Draft | about 480p | xAI Grok Imagine Video 1.5 Lite |
| Standard | about 720p | xAI Grok Imagine Video 1.5 Lite |
| High | 1080p | xAI Lite, which upscales 720p. OpenRouter's High preset uses Wan 3.0 |
| Max | premium 1080p | xAI Grok Imagine Video 1.5, or Veo 3.1 on fal / OpenRouter / Replicate |

A preset sets the model, resolution, frame rate, and steps for the provider you have selected. Duration stays what you set, then each provider snaps it to a length that model accepts. Changing the model, resolution, frame rate, or steps by hand switches the preset to Custom.

Estimates are per generated second, multiplied by the shot list. Stitching is free. Unknown models say **Check provider** instead of a guessed price. Refresh OpenRouter models to replace the fallback with live `pricing_skus`.

Rates below were taken from provider pages around 21 October 2026. Confirm them before a long run.

| Route | Rough price |
| --- | --- |
| xAI Lite 480p / 720p / 1080p | $0.02 / $0.03 / $0.14 per second. 1080p is an upscale |
| xAI 1.5 480p / 720p / 1080p | $0.08 / $0.14 / $0.25 per second. Native 1080p |
| OpenRouter Wan 3.0 | about $0.05/s at 480p and $0.20/s at 1080p. 720p stays "Check provider" until you refresh |
| OpenRouter Kling 3.0 Standard | about $0.084/s without audio |
| fal Kling 2.5 Turbo Pro | $0.07/s after the $0.35 five-second base |
| ComfyUI and the mock provider | $0 |

OpenRouter's Veo sample SKU in the docs is about $0.50/s, and $0.75/s at 1080p. That number is a sample. The refresh button replaces it.

## Providers

Calls go from the browser when the host allows it. **Auto** tries the browser first, then SillyTavern's built-in `/proxy` if the direct call fails. Keys are read from extension settings.

| Provider | Browser | Notes |
| --- | --- | --- |
| xAI Grok Imagine | Direct | Default. `POST https://api.x.ai/v1/videos/generations`, then poll. Lite is the cheap hosted option. There is no cancel endpoint; Cancel stops polling. |
| OpenRouter video | Direct | `POST https://openrouter.ai/api/v1/videos` for Grok Imagine, Wan 3.0, Kling 3.0, Seedance, Veo 3.1, Hailuo, and the rest of the live catalog. Refresh models after you add a key. |
| fal.ai | Direct | Wan 2.2, Kling 2.5 Turbo Pro, Kling v3, Hailuo 02, Veo 3.1. |
| ComfyUI | Your machine | Unrestricted local route. See below. |
| Mock | This page | A short title card, so you can try selection, the shot list, and download with no key. |
| Custom API | Auto | Submit URL, poll URL, and JSON templates. Use this for Runway, Luma, or another host. |
| Replicate | **Needs the CORS proxy** | Replicate does not allow browser calls. The panel says so when you select it. |

Checked from the browser on 21 October 2026: fal, xAI, and OpenRouter accept browser calls. Replicate, Runway, and Kling's own API do not. Kling on fal, Replicate, or OpenRouter is a different host from Kling's own API.

This extension does not call OpenAI Sora 2. That API was shut down. It also does not call the Gemini API Veo 3.1 preview, which Google scheduled to shut down on 22 October 2026 in favor of Gemini Omni Flash 1.1. Veo 3.1 can still appear as a model id on fal, OpenRouter, or Replicate. Those are those companies' routes, not the Gemini API.

### Replicate and the CORS proxy

Replicate will not work until the proxy is on:

- In `config.yaml`: `enableCorsProxy: true`
- Or start SillyTavern with `--corsProxy`

Restart after changing it. The proxy is same-origin and forwards `Authorization`. It drops query strings, so it cannot fetch ComfyUI's `/view?filename=…` URL. On a server other people can reach, the proxy is an SSRF risk. A private-address whitelist can also stop the server from calling `127.0.0.1`.

### ComfyUI

1. Start ComfyUI so the page may call it: `python main.py --enable-cors-header *`
2. Use that flag only on a machine you control. Do not expose that port to the internet. `*` lets any local page talk to ComfyUI.
3. In the panel, set the URL (default `http://127.0.0.1:8188`) and load a workflow exported as **API format**. A canvas file (`nodes` array) is rejected with a note to turn on Dev Mode and export API format.
4. The extension fills the positive prompt, negative prompt, seed, width, height, frame count, fps, and a LoadImage filename when it can find those inputs. Node titles `Positive Prompt` and `Negative Prompt` win. An optional JSON mapping overrides the guess.

Shipped examples:

- `workflows/wan-t2v.api.json` — Wan 2.2 14B text-to-video skeleton. Checkpoint names are placeholders. The two-stage high-noise / low-noise graph should be exported from your own install. Kijai's WanVideoWrapper uses different class names; the mapper follows field names and titles, but you should still check the mapping.
- `workflows/ltx-2.3-t2v.api.json` — LTX-2.3 GGUF text-to-video. It expects ComfyUI-GGUF, ComfyUI-LTXVideo, `ltx-2.3-22b-dev-Q8_0.gguf`, the LTX 2.3 VAE, and a Gemma CLIP loaded as type `ltxv`. The example is 20 steps at CFG 3. A distilled LoRA path is often 8 steps at CFG 1; export that graph if that is what you run.

HunyuanVideo 1.5 is not shipped as a pretend graph. Export API format from your install. The mapper understands `EmptyHunyuanLatentVideo` width, height, and length.

Image-to-video: add a LoadImage node. A reference still is uploaded to `/upload/image` and the filename is written into that node. Upload and `/view` need direct CORS. WebSocket progress is direct-only. History polling is the fallback and can use the SillyTavern proxy, because `/history/{id}` has no query string.

An `https://` SillyTavern page cannot call `http://127.0.0.1:8188`. Local SillyTavern is usually `http://127.0.0.1:8000`, which can.

### Custom API tokens

A JSON value that is exactly `{{duration}}` stays a number. Quotes in `{{prompt}}` are safe because the template is parsed as JSON first.

`prompt`, `negative_prompt`, `duration`, `aspect_ratio`, `resolution`, `fps`, `steps`, `seed`, `width`, `height`, `image_url`, `disable_safety_checker`, `api_key`. Poll and cancel URLs may also use `id`.

### Shot-list model

- **SillyTavern** uses `generateRaw` with a JSON schema, then retries without the schema, then `generateQuietPrompt`.
- **OpenRouter** uses the video key and a text model (`openrouter/auto` unless you change it).
- **OpenAI-compatible** uses the base URL, key, and model under Extensions → Scene Video. A local server such as `http://127.0.0.1:5000/v1` works when it allows the browser or the proxy.

The storyboard prompt tells the model the text is your fiction, including when it is mature, and to describe the picture without adding a warning or a refusal. This extension does not filter prompts or videos.

## Adult roleplay

Hosted labs still apply their own rules.

- **Local ComfyUI** (Wan 2.2 14B, HunyuanVideo 1.5, LTX-2.3) is the unrestricted route, unless a node inside your workflow adds a checker. This extension does not add one.
- **fal**: the safety checkbox sends `enable_safety_checker: false` for Kling 2.5 Turbo Pro and Wan 2.2, and `safety_tolerance: "6"` for fal's Veo 3.1. fal can ignore the flag unless the account is allowed to turn the checker off. Kling v3 and Hailuo have no switch in the published schema.
- **Replicate**: Wan 2.2 fast gets `disable_safety_checker`. Kling and Veo on Replicate do not publish that switch.
- **OpenRouter** has no global switch. The lab behind the model applies its own policy.
- **xAI** can reject a prompt and marks some outputs as moderated. It is not an unrestricted route.
- **Custom**: put the host's own safety field in the body template if you want one.

## Keys and the proxy

API keys are stored in SillyTavern's `extension_settings` (`settings.json` on the server) and in this browser. Anyone who can read that file or this browser profile can read them.

ffmpeg.wasm 0.11.6 is loaded from jsDelivr the first time a multi-clip stitch runs. SillyTavern does not send the headers newer ffmpeg builds require, so this stays on the single-thread build. Audio is dropped during the stitch so mixed clips do not fail the concat. If the CDN is blocked, download the clips separately.

## Develop

```bash
node --test tests/
```

`dev/preview.html` is a stub chat that loads the same panel. From the repository root:

```bash
python3 -m http.server 43123
```

Open `http://127.0.0.1:43123/dev/preview.html`. The stub answers the shot-list call locally and records the mock provider in the browser. It is not a SillyTavern screenshot.

To add a video provider, copy a file in `lib/providers/`, implement `generate(request) -> Promise<Blob>`, and append it to `providers` in `lib/providers/registry.js`.
