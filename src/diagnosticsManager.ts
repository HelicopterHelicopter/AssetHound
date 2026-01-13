import * as vscode from 'vscode';
import { DetectedUrl } from './urlScanner';
import { ValidationResult } from './linkValidator';

/**
 * Manages VS Code diagnostics for broken links
 */
export class DiagnosticsManager {
  private diagnosticCollection: vscode.DiagnosticCollection;

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('brokenLinks');
  }

  /**
   * Update diagnostics for a document based on validation results
   */
  updateDiagnostics(
    document: vscode.TextDocument,
    detectedUrls: DetectedUrl[],
    validationResults: ValidationResult[]
  ): void {
    // Create a map of URL to validation result for quick lookup
    const resultMap = new Map<string, ValidationResult>();
    for (const result of validationResults) {
      resultMap.set(result.url, result);
    }

    const diagnostics: vscode.Diagnostic[] = [];

    for (const detected of detectedUrls) {
      const result = resultMap.get(detected.url);
      
      if (result && !result.isValid) {
        const message = this.formatDiagnosticMessage(result);
        
        const diagnostic = new vscode.Diagnostic(
          detected.range,
          message,
          vscode.DiagnosticSeverity.Warning
        );
        
        diagnostic.source = 'Broken Link Detector';
        diagnostic.code = result.statusCode || 'ERROR';
        
        diagnostics.push(diagnostic);
      }
    }

    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  /**
   * Format a user-friendly diagnostic message
   */
  private formatDiagnosticMessage(result: ValidationResult): string {
    if (result.statusCode) {
      return `Broken link (${result.statusCode} ${result.statusText || 'Error'}): ${this.truncateUrl(result.url)}`;
    }
    
    if (result.error) {
      return `Broken link (${result.error}): ${this.truncateUrl(result.url)}`;
    }
    
    return `Broken link: ${this.truncateUrl(result.url)}`;
  }

  /**
   * Truncate long URLs for display
   */
  private truncateUrl(url: string, maxLength: number = 60): string {
    if (url.length <= maxLength) {
      return url;
    }
    return url.substring(0, maxLength - 3) + '...';
  }

  /**
   * Clear diagnostics for a specific document
   */
  clearDiagnostics(document: vscode.TextDocument): void {
    this.diagnosticCollection.delete(document.uri);
  }

  /**
   * Clear all diagnostics
   */
  clearAll(): void {
    this.diagnosticCollection.clear();
  }

  /**
   * Dispose of the diagnostic collection
   */
  dispose(): void {
    this.diagnosticCollection.dispose();
  }
}
