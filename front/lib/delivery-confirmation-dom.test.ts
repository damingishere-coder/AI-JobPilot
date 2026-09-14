import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { resolve } from 'node:path';

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
  const scope: Record<string, any> = {};
  vm.runInNewContext(fs.readFileSync(resolve(process.cwd(), '../chrome-extension/boss-page-evidence.js'), 'utf8'), { window: scope });
  const count = (greeting: string, _input: unknown) => scope.GetJobsBossPageEvidence.countRenderedGreetingMessages(document, greeting);
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
  const scope: Record<string, any> = {};
  vm.runInNewContext(fs.readFileSync(resolve(process.cwd(), '../chrome-extension/boss-page-evidence.js'), 'utf8'), { window: scope });
  const count = (greeting: string, _input: unknown) => scope.GetJobsBossPageEvidence.countRenderedGreetingMessages(document, greeting);
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

test('Zhilian recognizes the live daily-limit wording as a failed action', () => {
  const document = dom('<div>今日投递已超过上限，明天再试吧！</div>');
  const scope = { document, window: { location: { href: 'https://www.zhaopin.com/jobdetail/test.htm' } },
    compact: (s: unknown) => String(s || '').trim(), isSecurityPrompt: () => false, isStrongLoginPrompt: () => false,
    firstMatch: (s: string, pattern: RegExp) => s.match(pattern)?.[0] || '' };
  const detect = vm.runInNewContext(readFunction('zhilian-content.js', 'detectZhilianDeliveryFailure', 'classifyDeliveryFailure') + '; detectZhilianDeliveryFailure', scope);
  const classify = vm.runInNewContext(readFunction('zhilian-content.js', 'classifyDeliveryFailure', 'normalizeFailurePayload') + '; classifyDeliveryFailure', scope);
  assert.equal(detect(''), '今日投递已超过上限');
  assert.equal(classify(detect('')).failureType, 'DELIVERY_LIMIT');
  document.body.innerHTML = '<div>今日投递机会已用完</div>';
  assert.equal(classify(detect('')).failureType, 'DELIVERY_LIMIT');
  document.body.innerHTML = '<div>普通岗位描述</div>';
  assert.equal(detect(''), '');
});

test('BOSS acknowledges only the positive-quota reminder once, never restrictions or unrelated dialogs', () => {
  const document = dom('');
  let clicks = 0;
  const code = readFunction('boss-content.js', 'isVisibleElement', 'isStrongLoginPrompt')
    + readFunction('boss-content.js', 'acknowledgeRemainingCommunicationReminder', 'executeDeliveryOnce');
  const acknowledge = vm.runInNewContext(code + '; acknowledgeRemainingCommunicationReminder', {
    document, window, compact: (s: unknown) => String(s || '').trim(), clickElement: () => { clicks++; },
  });
  const fixture = (content: string, title = '温馨提示') => {
    document.body.innerHTML = `<div class="dialog-wrap"><div class="dialog-title"><h3>${title}</h3></div><div class="dialog-con">${content}</div><div class="dialog-footer"><span class="btn btn-sure">好</span></div></div>`;
    // Live BOSS CSS fixes this overlay to the viewport: visible with a null offsetParent.
    const dialog = document.querySelector('.dialog-wrap') as HTMLElement;
    dialog.style.position = 'fixed';
    Object.defineProperty(dialog, 'offsetParent', { get: () => null });
    for (const element of [dialog, document.querySelector('.btn-sure')!]) {
      element.getBoundingClientRect = () => ({ width: 300, height: 150 }) as DOMRect;
    }
  };
  const acknowledged = new WeakSet();
  fixture('您今天已与120位BOSS沟通，还剩30次沟通机会哦');
  assert.equal(acknowledge(acknowledged), true);
  assert.equal(acknowledge(acknowledged), false);
  assert.equal(clicks, 1);
  for (const content of ['您今天已与150位BOSS沟通，还剩0次沟通机会哦', '今日沟通次数已用完', '请完成安全验证', '请重新登录', '购买会员获得30次沟通机会', '您今天已与120位BOSS沟通，还剩30次沟通机会哦，请同意服务协议']) {
    fixture(content);
    assert.equal(acknowledge(acknowledged), false);
  }
  fixture('您今天已与120位BOSS沟通，还剩30次沟通机会哦', '服务协议');
  assert.equal(acknowledge(acknowledged), false);
  fixture('您今天已与120位BOSS沟通，还剩30次沟通机会哦');
  (document.querySelector('.dialog-wrap') as HTMLElement).style.display = 'none';
  assert.equal(acknowledge(acknowledged), false);
  assert.equal(clicks, 1);
});

test('BOSS classifies actual restrictions without mistaking the QR sharing footer for login', () => {
  const document = dom('<p>微信扫码分享</p><p>职位已关闭</p>');
  const location = { href: 'https://www.zhipin.com/job_detail/example.html' };
  const code = readFunction('boss-content.js', 'isStrongLoginPrompt', 'buildNavigationKey')
    + readFunction('boss-content.js', 'classifyDeliveryFailure', 'normalizeFailurePayload');
  const classify = vm.runInNewContext(code + '; classifyDeliveryFailure', {
    document, window: { location }, compact: (s: unknown) => String(s || '').trim(),
    isSecurityPrompt: (s: string) => s.includes('请完成安全验证'),
  });
  assert.equal(classify('职位已关闭').failureType, 'JOB_CLOSED');
  assert.equal(classify('今日沟通次数已用完').failureType, 'DELIVERY_LIMIT');
  assert.equal(classify('Boss登录状态失效').failureType, 'LOGIN_EXPIRED');
  assert.equal(classify('Boss页面出现安全验证').failureType, 'PLATFORM_VERIFICATION');
  location.href = 'https://www.zhipin.com/web/passport/zp/verify.html';
  assert.equal(classify('当前页面不是目标岗位详情页').failureType, 'PLATFORM_VERIFICATION');
});
