# Broken Link Detector

A VS Code extension that automatically detects and validates CDN URLs and asset links in your code. It shows warnings for broken links directly in the editor.

## Features

- **Automatic URL Detection**: Scans your code for CDN URLs and asset file links
- **Non-blocking Validation**: Validates links in the background without interrupting your typing
- **Smart Caching**: Caches validation results for 5 minutes to avoid redundant requests
- **Inline Warnings**: Shows warnings directly in the editor for broken links

## Detected URL Types

### CDN URLs

- CloudFront (`*.cloudfront.net`)
- Cloudflare
- Akamai
- Fastly
- jsDelivr
- unpkg
- cdnjs
- Any URL containing `cdn.` or `.cdn.`

### Asset Files

URLs ending with common asset extensions:

- **Images**: `.jpg`, `.jpeg`, `.png`, `.gif`, `.svg`, `.webp`, `.ico`, `.bmp`, `.tiff`, `.avif`
- **Video**: `.mp4`, `.webm`, `.avi`, `.mov`, `.mkv`
- **Audio**: `.mp3`, `.wav`, `.ogg`, `.flac`, `.aac`
- **Fonts**: `.woff`, `.woff2`, `.ttf`, `.eot`, `.otf`
- **Documents**: `.pdf`
- **Animation**: `.riv`, `.lottie`
- **Data**: `.json`

## Supported File Types

The extension activates for these file types:

- JavaScript / TypeScript (`.js`, `.ts`, `.jsx`, `.tsx`)
- HTML / CSS / SCSS / LESS
- JSON / YAML
- Markdown
- Vue / Svelte
- And more...

## How It Works

1. **Debouncing**: The extension waits 500ms after you stop typing before scanning
2. **URL Scanning**: Regex-based detection of URLs matching CDN patterns or asset extensions
3. **HEAD Requests**: Uses lightweight HTTP HEAD requests to check link validity
4. **Caching**: Results are cached for 5 minutes to improve performance
5. **Diagnostics**: Broken links appear as warnings in VS Code's Problems panel

## Example

```typescript
// This URL will be validated
const logo = "https://d1ioice0blp2od.cloudfront.net/fmtapp/asset/logo.png";

// This will show a warning if the image doesn't exist
const brokenImage = "https://example.com/missing-image.jpg";
```

## Installation

### From VSIX (Local Development)

1. Clone this repository
2. Run `npm install`
3. Run `npm run compile`
4. Package with `vsce package`
5. Install the generated `.vsix` file in VS Code

### Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch
```

## Requirements

- VS Code 1.85.0 or higher

## Known Limitations

- Only HTTP/HTTPS URLs are supported
- Some CDN URLs may require authentication and will show as broken
- Rate limiting from CDN providers may cause false positives

## License

Apache-2.0

Copyright 2026 Omnia Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
