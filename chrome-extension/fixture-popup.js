(function () {
  const capture = document.getElementById("capture"), preview = document.getElementById("preview");
  const reviewed = document.getElementById("reviewed"), download = document.getElementById("download");
  const pageType = document.getElementById("page-type"), status = document.getElementById("status");
  let bundle = null, generation = 0;
  function clear() {
    generation++; bundle = null; preview.value = ""; reviewed.checked = false; reviewed.disabled = true; download.disabled = true;
    status.textContent = "预览已清除；未写入扩展存储或后端。";
  }
  document.getElementById("clear").addEventListener("click", clear);
  pageType.addEventListener("change", clear);
  reviewed.addEventListener("change", () => { download.disabled = !bundle || !reviewed.checked; });
  capture.addEventListener("click", async () => {
    clear(); const current = generation, type = pageType.value; capture.disabled = true;
    status.textContent = "正在生成脱敏结构预览…";
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url) throw { code: "NO_ACTIVE_TAB" };
      const platform = window.GetJobsFixtureExporter.platformFor(tab.url);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["fixture-export.js"] });
      if (generation !== current) return;
      const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [type], func: type => window.GetJobsFixtureExporter.captureSafely(document, window.location.href, type) });
      if (generation !== current) return;
      if (result.length !== 1 || !result[0].result) throw { code: "PAGE_CHANGED" };
      const captureResult = result[0].result;
      if (!captureResult.ok) throw { code: captureResult.errorCode };
      if (captureResult.bundle?.platform !== platform || captureResult.bundle.pageType !== type) throw { code: "PAGE_CHANGED" };
      bundle = captureResult.bundle;
      preview.value = JSON.stringify(bundle, null, 2); reviewed.disabled = false;
      status.textContent = `已生成 ${bundle.rootCount} 个脱敏结构。请检查预览后再下载；不代表真实网站测试通过。`;
      if (bundle.warnings?.length) status.textContent += ` 当前是部分结构样本：${bundle.warnings.map(code => window.GetJobsFixtureExporter.warningMessage(code)).join("；")}。可保留用于诊断，但不能作为完整采集验收。`;
    } catch (error) {
      if (generation === current) status.textContent = `无法导出：${window.GetJobsFixtureExporter.errorMessage(error?.code)} 没有生成文件。`;
    } finally { capture.disabled = false; }
  });
  download.addEventListener("click", () => {
    if (!bundle || !reviewed.checked) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `${bundle.platform}-${bundle.pageType.toLowerCase()}-fixture.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
