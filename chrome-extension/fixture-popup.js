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
      if (!tab?.id || !tab.url) throw new Error("未找到当前页面");
      const platform = window.GetJobsFixtureExporter.platformFor(tab.url);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["fixture-export.js"] });
      if (generation !== current) return;
      const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [type], func: type => window.GetJobsFixtureExporter.capture(document, window.location.href, type) });
      if (generation !== current) return;
      if (result.length !== 1 || !result[0].result || result[0].result.platform !== platform) throw new Error("页面已变化或未产生样本，请重新检查");
      bundle = result[0].result;
      preview.value = JSON.stringify(bundle, null, 2); reviewed.disabled = false;
      status.textContent = `已生成 ${bundle.rootCount} 个脱敏结构。请检查预览后再下载；不代表真实网站测试通过。`;
    } catch {
      if (generation === current) status.textContent = "无法导出：请确认当前为支持的招聘页面、样本类型正确且扩展已重载。没有生成文件。";
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
