/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Converts standard markdown strings into beautifully styled inline-CSS HTML.
 * This HTML is highly compatible with Gmail, Google Docs, Outlook, and other rich text editors.
 */
export function markdownToRichHtml(md: string): string {
  let html = md;

  // Escape HTML tags to protect integrity, though keeping code blocks safe
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code Blocks: ```lang ... ```
  html = html.replace(/```(?:[a-zA-Z0-9-]*)\n([\s\S]*?)```/g, (match, code) => {
    return `<pre style="background-color: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; font-family: 'Courier New', Courier, monospace; font-size: 13px; color: #202124; overflow-x: auto; margin: 16px 0; line-height: 1.5;"><code>${code.trim()}</code></pre>`;
  });

  // Inline code badges: `code`
  html = html.replace(/`([^`]+)`/g, '<code style="font-family: \'Courier New\', Courier, monospace; background-color: #f1f3f4; color: #c5221f; padding: 2px 6px; border-radius: 4px; font-size: 13px; font-weight: bold;">$1</code>');

  // Bold headings/text: **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong style="color: #1a73e8; font-weight: 700;">$1</strong>');

  // Italic: *text* or _text_
  html = html.replace(/\*([^*]+)\*/g, '<em style="font-style: italic; color: #5f6368;">$1</em>');

  // Structure Headings
  html = html.replace(/^### (.*$)/gim, '<h3 style="color: #1a73e8; font-family: \'Google Sans\', Roboto, Arial, sans-serif; font-size: 16px; font-weight: 700; margin-top: 20px; margin-bottom: 8px; border-bottom: 1px solid #e8eaed; padding-bottom: 4px;">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 style="color: #1a73e8; font-family: \'Google Sans\', Roboto, Arial, sans-serif; font-size: 20px; font-weight: 700; margin-top: 24px; margin-bottom: 12px; border-bottom: 2px solid #dadce0; padding-bottom: 6px;">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 style="color: #185abc; font-family: \'Google Sans\', Roboto, Arial, sans-serif; font-size: 24px; font-weight: 800; margin-top: 24px; margin-bottom: 16px;">$1</h1>');

  // Convert Bullet list items and paragraphs line-by-line helper
  const lines = html.split('\n');
  let inList = false;
  
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    
    if (rawLine.startsWith('- ') || rawLine.startsWith('* ')) {
      const content = rawLine.substring(2);
      let listElement = `<li style="margin-bottom: 8px; color: #3c4043; line-height: 1.6; font-size: 14px;">${content}</li>`;
      
      if (!inList) {
        listElement = `<ul style="list-style-type: disc; padding-left: 20px; margin: 12px 0;">` + listElement;
        inList = true;
      }
      lines[i] = listElement;
    } else {
      let suffix = '';
      if (inList) {
        suffix = '</ul>';
        inList = false;
      }
      
      // If it is an empty line or already inside a structured tag, do not wrap in <p>
      if (rawLine === '') {
        lines[i] = suffix;
      } else if (
        rawLine.startsWith('<h') || 
        rawLine.startsWith('<ul') || 
        rawLine.startsWith('<li') || 
        rawLine.startsWith('<pre') || 
        rawLine.startsWith('</pre') || 
        rawLine.startsWith('<code>') || 
        rawLine.startsWith('</code>')
      ) {
        lines[i] = suffix + lines[i];
      } else {
        lines[i] = suffix + `<p style="margin-bottom: 12px; line-height: 1.6; color: #3c4043; font-size: 14px; font-family: Roboto, Arial, sans-serif;">${lines[i]}</p>`;
      }
    }
  }

  if (inList) {
    lines.push('</ul>');
  }

  html = lines.join('\n');

  // Overall visual container envelope matches Google Doc / clean corporate style
  return `
    <div style="font-family: Roboto, Arial, sans-serif; font-size: 14px; color: #3c4043; line-height: 1.6; max-width: 650px; background-color: #ffffff; border: 1px solid #dadce0; border-radius: 8px; padding: 24px; margin: 10px auto; box-shadow: 0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15);">
      ${html}
    </div>
  `;
}

/**
 * Strips raw markdown tags and renders an elegantly formatted human text report.
 */
export function markdownToPlainText(md: string): string {
  let text = md;

  // Code Block dividers: strip backticks and pad with spacers
  text = text.replace(/```(?:[a-zA-Z0-9-]*)\n([\s\S]*?)```/g, '\n[Code Block Start]\n$1\n[Code Block End]\n');

  // Inline codes: replace tags
  text = text.replace(/`([^`]+)`/g, '$1');

  // Bold content: replace with capital labels or plain text
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');

  // Italics: strip symbols
  text = text.replace(/\*([^*]+)\*/g, '$1');

  // Heading symbols: clean and align
  text = text.replace(/^### (.*$)/gim, '\n=== $1 ===\n');
  text = text.replace(/^## (.*$)/gim, '\n================== $1 ==================\n');
  text = text.replace(/^# (.*$)/gim, '\n==================================================\n$1\n==================================================\n');

  return text.trim();
}
