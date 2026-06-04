import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(indexHtml, /async function triggerDownload/, 'download helper should support async mobile sharing');
assert.match(indexHtml, /new File\(\[blob\], fileName/, 'download helper should create a real File object for Android sharing');
assert.match(indexHtml, /navigator\.canShare/, 'download helper should detect native file sharing support');
assert.match(indexHtml, /navigator\.share/, 'download helper should use native share sheet before blob URL fallback');
assert.match(indexHtml, /isAndroidLikeExportHost/, 'download helper should identify Android embedded browser environments');
assert.match(indexHtml, /isAndroidLikeExportHost\(\) && navigator\.canShare/, 'native sharing should be limited to Android embedded browsers so Apple users keep the existing download path');
assert.match(indexHtml, /download-fallback-panel/, 'download helper should provide an in-page fallback when direct download is blocked');
assert.match(indexHtml, /手动下载文件/, 'fallback panel should give users a manual download action');
assert.match(indexHtml, /await triggerDownload\(html, fileName\)/, 'call report export should wait for the export path to complete');
assert.match(indexHtml, /function persistCurrentDraft/, 'record persistence should be separated from the export completion toast');
assert.match(indexHtml, /persistCurrentDraft\(true\);[\s\S]*await triggerDownload\(html, fileName\)/, 'call report records should be uploaded before Android share or browser export can block');
assert.match(indexHtml, /persistCurrentDraft\(false\);[\s\S]*await triggerDownload\(html, fileName\)/, 'site text records should be uploaded before Android share or browser export can block');
