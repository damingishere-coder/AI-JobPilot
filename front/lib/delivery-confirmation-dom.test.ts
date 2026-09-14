import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function readFunction(file: string, name: string, next: string) {
  const text = fs.readFileSync(new URL('../../chrome-extension/' + file, import.meta.url), 'utf8');
  return text.slice(text.indexOf('  function ' + name + '('), text.indexOf('  function ' + next + '('));
}
function dom(html: string) {
  const document = window.document.implementation.createHTMLDocument('delivery fixture');
  document.body.innerHTML = html;
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.style.display === 'none' ? null : this.parentElement; } });
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
  return document;
}

test('Zhilian compares each label independently instead of concatenating duplicate DOM text', () => {
  const code = readFunction('zhilian-content.js', 'detectZhilianDeliveryStatus', 'detectZhilianDeliveryFailure');
  const detect = vm.runInNewContext(code + '; detectZhilianDeliveryStatus', { compact: (s: unknown) => String(s || '').trim() });
  assert.equal(detect(dom('<button>继续沟通</button>')), '已投递');
  assert.equal(detect(dom('<button>投递简历</button>')), '');
  assert.equal(detect(dom('<div class="modal"><h3>已向对方发送简历和打招呼语</h3></div>')), '已投递');
  assert.equal(detect(dom('<div class="modal" style="display:none">已向对方发送简历和打招呼语</div>')), '');
  assert.equal(detect(dom('<p>职位描述：帮助用户提高投递成功率</p>')), '');
});

test('BOSS counts exact outgoing body despite sent status and line breaks, excluding failed or other text', () => {
  const document = dom('<div class="item-myself"><span class="message-status">已发送</span><div class="text">您好<br>作品集：https://example.com/</div></div>');
  const code = readFunction('boss-content.js', 'countRenderedGreetingMessages', 'buildDeliverySuccessMessage');
  const count = vm.runInNewContext(code + '; countRenderedGreetingMessages', { document, normalizeGreetingText: (s: unknown) => String(s || '').trim() });
  assert.equal(count('您好\n作品集：https://example.com/', null), 1);
  assert.equal(count('其他话术', null), 0);
  document.querySelector('.item-myself')!.insertAdjacentHTML('beforeend', '<span class="send-failed">发送失败</span>');
  assert.equal(count('您好\n作品集：https://example.com/', null), 0);
  document.body.innerHTML = '<div class="message-content">您好</div>';
  assert.equal(count('您好', null), 0);
});

test('BOSS detail popup requires the send callback message id and success status', () => {
  // Structure from BOSS public chatDialog renderer, independently observed in live UI.
  const document = dom('<div class="startchat-content"><div class="message"><ul class="message-list"><li class="message-item" id="385898401231112"><span class="status success">已发送</span><p class="text">您好，作品集：https://example.com/</p></li></ul></div></div>');
  const code = readFunction('boss-content.js', 'countRenderedGreetingMessages', 'buildDeliverySuccessMessage');
  const count = vm.runInNewContext(code + '; countRenderedGreetingMessages', { document, normalizeGreetingText: (s: unknown) => String(s || '').trim() });
  const greeting = '您好，作品集：https://example.com/';
  assert.equal(count(greeting, null), 1);
  assert.equal(count('不同话术', null), 0);
  const row = document.querySelector('.message-item')!;
  row.removeAttribute('id');
  assert.equal(count(greeting, null), 0);
  row.id = '385898401231112';
  const status = row.querySelector('.status')!;
  status.className = 'status sending';
  assert.equal(count(greeting, null), 0);
  status.className = 'status error';
  assert.equal(count(greeting, null), 0);
  status.className = 'status success';
  document.querySelector('.startchat-content')!.className = 'unrelated';
  assert.equal(count(greeting, null), 0);
});
