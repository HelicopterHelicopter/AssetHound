import * as vscode from 'vscode';
import { UrlCache } from './cache';
import { scanDocument, getSupportedLanguages } from './urlScanner';
import { LinkValidator } from './linkValidator';
import { DiagnosticsManager } from './diagnosticsManager';

// Debounce delay in milliseconds
const DEBOUNCE_DELAY = 500;

// Track debounce timers per document
const debounceTimers: Map<string, NodeJS.Timeout> = new Map();

// Global instances
let cache: UrlCache;
let validator: LinkValidator;
let diagnosticsManager: DiagnosticsManager;

/**
 * Process a document - scan for URLs and validate them
 */
async function processDocument(document: vscode.TextDocument): Promise<void> {
  // Only process supported languages
  const supportedLanguages = getSupportedLanguages();
  if (!supportedLanguages.includes(document.languageId)) {
    return;
  }

  // Scan for URLs
  const detectedUrls = scanDocument(document);
  
  if (detectedUrls.length === 0) {
    // Clear any existing diagnostics if no URLs found
    diagnosticsManager.clearDiagnostics(document);
    return;
  }

  // Extract unique URLs
  const urls = detectedUrls.map(d => d.url);
  
  // Validate URLs
  const results = await validator.validateUrls(urls);
  
  // Update diagnostics
  diagnosticsManager.updateDiagnostics(document, detectedUrls, results);
}

/**
 * Debounced document processing
 */
function debouncedProcessDocument(document: vscode.TextDocument): void {
  const uri = document.uri.toString();
  
  // Clear existing timer for this document
  const existingTimer = debounceTimers.get(uri);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  
  // Set new timer
  const timer = setTimeout(() => {
    debounceTimers.delete(uri);
    processDocument(document).catch(err => {
      console.error('Error processing document:', err);
    });
  }, DEBOUNCE_DELAY);
  
  debounceTimers.set(uri, timer);
}

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('Broken Link Detector is now active');

  // Initialize components
  cache = new UrlCache(5); // 5 minute TTL
  validator = new LinkValidator(cache, 5000, 5); // 5s timeout, 5 concurrent
  diagnosticsManager = new DiagnosticsManager();

  // Process all open documents on activation
  for (const document of vscode.workspace.textDocuments) {
    debouncedProcessDocument(document);
  }

  // Listen for document changes
  const changeDisposable = vscode.workspace.onDidChangeTextDocument(event => {
    debouncedProcessDocument(event.document);
  });

  // Listen for document opens
  const openDisposable = vscode.workspace.onDidOpenTextDocument(document => {
    debouncedProcessDocument(document);
  });

  // Listen for document closes - clear diagnostics
  const closeDisposable = vscode.workspace.onDidCloseTextDocument(document => {
    diagnosticsManager.clearDiagnostics(document);
    
    // Clear any pending timer
    const uri = document.uri.toString();
    const timer = debounceTimers.get(uri);
    if (timer) {
      clearTimeout(timer);
      debounceTimers.delete(uri);
    }
  });

  // Periodic cache cleanup (every 5 minutes)
  const cleanupInterval = setInterval(() => {
    cache.cleanup();
  }, 5 * 60 * 1000);

  // Register disposables
  context.subscriptions.push(
    changeDisposable,
    openDisposable,
    closeDisposable,
    diagnosticsManager,
    {
      dispose: () => {
        clearInterval(cleanupInterval);
        // Clear all debounce timers
        for (const timer of debounceTimers.values()) {
          clearTimeout(timer);
        }
        debounceTimers.clear();
        // Cancel pending validations
        validator.cancel();
      }
    }
  );
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
  console.log('Broken Link Detector is now deactivated');
}
