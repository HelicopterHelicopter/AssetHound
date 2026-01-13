import * as vscode from 'vscode';

/**
 * Represents a detected URL with its position in the document
 */
export interface DetectedUrl {
  url: string;
  range: vscode.Range;
}

// CDN domain patterns to match
const CDN_PATTERNS = [
  /cloudfront\.net/i,
  /cdn\./i,
  /\.cdn\./i,
  /cloudflare/i,
  /akamai/i,
  /fastly/i,
  /jsdelivr/i,
  /unpkg/i,
  /cdnjs/i,
];

// Asset file extensions to match
const ASSET_EXTENSIONS = [
  // Images
  'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff', 'avif',
  // Video
  'mp4', 'webm', 'avi', 'mov', 'mkv',
  // Audio
  'mp3', 'wav', 'ogg', 'flac', 'aac',
  // Fonts
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  // Documents
  'pdf',
  // Animation
  'riv', 'lottie',
  // Data (commonly used as assets)
  'json',
];

// Build regex pattern for asset extensions
const ASSET_EXTENSION_PATTERN = new RegExp(
  `\\.(${ASSET_EXTENSIONS.join('|')})(\\?[^\\s"'\`>\\]]*)?$`,
  'i'
);

// Main URL regex - matches http:// and https:// URLs
// Now includes parentheses to capture URLs like: image%20(1).png
const URL_REGEX = /https?:\/\/[^\s"'`<>[\]{}\\]+/gi;

/**
 * Check if a URL matches our criteria (CDN or asset file)
 */
function shouldCheckUrl(url: string): boolean {
  // Check if it's a CDN URL
  for (const pattern of CDN_PATTERNS) {
    if (pattern.test(url)) {
      return true;
    }
  }

  // Check if it has an asset file extension
  if (ASSET_EXTENSION_PATTERN.test(url)) {
    return true;
  }

  return false;
}

/**
 * Clean up a captured URL by removing trailing characters that shouldn't be part of it
 * Handles tricky cases like:
 *   - url(https://example.com/image.png) -> strip trailing )
 *   - https://example.com/image%20(1).png -> keep the (1)
 */
function cleanUrl(url: string): string {
  let cleaned = url;
  
  // Remove trailing punctuation (but not parentheses yet)
  cleaned = cleaned.replace(/[,;:!?.]+$/, '');
  
  // Remove trailing quotes or square/curly brackets
  cleaned = cleaned.replace(/["'`\]}>]+$/, '');
  
  // Handle parentheses carefully - only strip unbalanced trailing )
  // Count opening and closing parentheses
  let openCount = 0;
  let closeCount = 0;
  for (const char of cleaned) {
    if (char === '(') openCount++;
    if (char === ')') closeCount++;
  }
  
  // If there are more closing than opening, strip trailing )
  while (closeCount > openCount && cleaned.endsWith(')')) {
    cleaned = cleaned.slice(0, -1);
    closeCount--;
  }
  
  // Also strip trailing ) if URL ends with common patterns like .png) or .jpg)
  // This handles: url(https://cdn.example.com/image.png)
  const extPattern = /\.(jpg|jpeg|png|gif|svg|webp|ico|mp4|webm|mp3|wav|pdf|riv|json|woff|woff2|ttf)\)$/i;
  if (extPattern.test(cleaned)) {
    cleaned = cleaned.slice(0, -1);
  }
  
  return cleaned;
}

/**
 * Scan a document for URLs that should be validated
 */
export function scanDocument(document: vscode.TextDocument): DetectedUrl[] {
  const text = document.getText();
  const detectedUrls: DetectedUrl[] = [];
  
  let match: RegExpExecArray | null;
  
  // Reset regex state
  URL_REGEX.lastIndex = 0;
  
  while ((match = URL_REGEX.exec(text)) !== null) {
    const rawUrl = match[0];
    const url = cleanUrl(rawUrl);
    
    if (shouldCheckUrl(url)) {
      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + url.length);
      
      detectedUrls.push({
        url,
        range: new vscode.Range(startPos, endPos),
      });
    }
  }

  return detectedUrls;
}

/**
 * Get the list of file types this extension supports
 */
export function getSupportedLanguages(): string[] {
  return [
    'javascript',
    'typescript',
    'javascriptreact',
    'typescriptreact',
    'html',
    'css',
    'scss',
    'less',
    'json',
    'jsonc',
    'yaml',
    'markdown',
    'vue',
    'svelte',
    'php',
    'python',
    'ruby',
    'go',
    'rust',
    'java',
    'kotlin',
    'swift',
    'plaintext',
  ];
}
