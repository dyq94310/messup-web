"use strict";

const supportedTypes = new Set(["shadowsocks", "hysteria2", "anytls", "vless", "trojan", "tuic"]);
const state = { inventory: null, template: null, nodes: [], templates: [], selectors: [], templateSearch: "", selectedOnly: false, activeType: "all", errorLines: { inventory: new Set(), template: new Set() } };
let parseTimer;

const elements = {
  inventoryInput: document.querySelector("#inventory-input"),
  templateInput: document.querySelector("#template-input"),
  inventoryLines: document.querySelector("#inventory-lines"), templateLines: document.querySelector("#template-lines"),
  inventoryStatus: document.querySelector("#inventory-status"),
  templateStatus: document.querySelector("#template-status"),
  inventoryErrors: document.querySelector("#inventory-errors"),
  templateErrors: document.querySelector("#template-errors"),
  nodes: document.querySelector("#nodes"), templates: document.querySelector("#templates"), selectors: document.querySelector("#selectors"),
  nodeCount: document.querySelector("#node-count"), templateCount: document.querySelector("#template-count"), summary: document.querySelector("#summary"),
  preview: document.querySelector("#preview"), previewStatus: document.querySelector("#preview-status"), copyButton: document.querySelector("#copy-button"), downloadButton: document.querySelector("#download-button"),
  templateSearch: document.querySelector("#template-search"), selectedOnly: document.querySelector("#selected-only"), typeFilters: document.querySelector("#type-filters"), templateSelectionSummary: document.querySelector("#template-selection-summary"),
};

for (const kind of ["inventory", "template"]) {
  elements[`${kind}Input`].addEventListener("input", () => { renderLineNumbers(kind); scheduleParse(); });
  elements[`${kind}Input`].addEventListener("scroll", () => { elements[`${kind}Lines`].scrollTop = elements[`${kind}Input`].scrollTop; });
  elements[`${kind}Input`].addEventListener("keyup", () => renderLineNumbers(kind));
  elements[`${kind}Input`].addEventListener("click", () => renderLineNumbers(kind));
}
elements.templateSearch.addEventListener("input", () => { state.templateSearch = elements.templateSearch.value.trim().toLowerCase(); renderTemplates(); });
elements.selectedOnly.addEventListener("change", () => { state.selectedOnly = elements.selectedOnly.checked; renderTemplates(); });
document.querySelector("#select-all-selectors").addEventListener("click", () => { state.selectors.forEach((item) => { item.selected = true; }); render(); });
document.querySelector("#clear-selectors").addEventListener("click", () => { state.selectors.forEach((item) => { item.selected = false; }); render(); });
elements.downloadButton.addEventListener("click", download);
elements.copyButton.addEventListener("click", copyPreview);
renderLineNumbers("inventory");
renderLineNumbers("template");

function scheduleParse() {
  window.clearTimeout(parseTimer);
  parseTimer = window.setTimeout(parseInputs, 400);
}

function parseInputs() {
  parseInventoryInput();
  parseTemplateInput();
  render();
}

function parseInventoryInput() {
  const text = elements.inventoryInput.value;
  if (!text.trim()) {
    state.inventory = null; state.nodes = [];
    state.errorLines.inventory = new Set();
    setValidation("inventory", "等待粘贴", "neutral", []);
    return;
  }
  try {
    const parsed = parseInventory(text);
    const nodes = getSingboxNodes(parsed.groups);
    const errors = [...parsed.errors, ...validateNodes(nodes)];
    state.inventory = errors.length ? null : parsed.groups;
    state.nodes = nodes;
    state.errorLines.inventory = new Set(errors.map((error) => error.line).filter(Boolean));
    setValidation("inventory", errors.length ? `${errors.length} 个问题` : `${nodes.length} 个节点有效`, errors.length ? "invalid" : "valid", errors);
  } catch (error) {
    state.inventory = null; state.nodes = [];
    state.errorLines.inventory = new Set();
    setValidation("inventory", "格式错误", "invalid", [{ message: error.message }]);
  }
}

function parseTemplateInput() {
  const text = elements.templateInput.value;
  if (!text.trim()) {
    state.template = null; state.templates = []; state.selectors = [];
    state.errorLines.template = new Set();
    setValidation("template", "等待粘贴", "neutral", []);
    return;
  }
  try {
    const config = JSON.parse(text);
    const errors = validateTemplate(config, text);
    const oldSamples = new Map(state.templates.map((item) => [item.outbound.tag, item]));
    const oldSelectors = new Map(state.selectors.map((item) => [item.outbound.tag, item]));
    state.template = errors.length ? null : config;
    state.templates = buildTemplateSamples(config.outbounds, oldSamples);
    state.selectors = Array.isArray(config.outbounds) ? config.outbounds.filter((item) => item.type === "selector").map((outbound) => ({ outbound, selected: oldSelectors.get(outbound.tag)?.selected ?? true })) : [];
    state.errorLines.template = new Set(errors.map((error) => error.line).filter(Boolean));
    setValidation("template", errors.length ? `${errors.length} 个问题` : `${state.templates.length} 个样板有效`, errors.length ? "invalid" : "valid", errors);
  } catch (error) {
    state.template = null; state.templates = []; state.selectors = [];
    const line = jsonErrorLine(error.message);
    state.errorLines.template = new Set(line ? [line] : []);
    setValidation("template", "JSON 格式错误", "invalid", [{ message: error.message, line, source: line ? getLineText(text, line) : "" }]);
  }
}

function parseInventory(text) {
  const groups = new Map(); const errors = []; let groupName = null;
  for (const [index, original] of text.split(/\r?\n/).entries()) {
    const line = original.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[([^\]]+)]$/);
    if (header) { groupName = header[1]; if (!groups.has(groupName)) groups.set(groupName, []); continue; }
    if (!groupName) { errors.push(validationError("主机定义必须位于 [group] 之后。", index + 1, original)); continue; }
    if (groupName.endsWith(":vars") || groupName.endsWith(":children")) continue;
    const [address, ...parts] = line.split(/\s+/);
    if (!address) continue;
    if (address.includes("=")) { errors.push(validationError("缺少主机地址，请将变量写在主机 IP 后。", index + 1, original)); continue; }
    const variables = {};
    for (const part of parts) {
      const at = part.indexOf("=");
      if (at < 1) errors.push(validationError(part === "singbox_name" ? "singbox_name 缺少值，应写为 singbox_name=us-01。" : `变量 ${part} 应为 key=value。`, index + 1, original));
      else if (!part.slice(at + 1)) errors.push(validationError(`${part.slice(0, at)} 不能为空。`, index + 1, original));
      else variables[part.slice(0, at)] = part.slice(at + 1);
    }
    groups.get(groupName).push({ address, variables, line: index + 1 });
  }
  if (!groups.has("singbox_nodes")) errors.push(validationError("缺少 [singbox_nodes] 分组。"));
  return { groups, errors };
}

function getSingboxNodes(groups) {
  if (!groups.has("singbox_nodes")) return [];
  const hosts = new Map();
  for (const [group, entries] of groups) {
    if (group === "singbox_nodes") continue;
    for (const entry of entries) {
      const previous = hosts.get(entry.address) || { address: entry.address, variables: {}, groups: [], line: entry.line };
      Object.assign(previous.variables, entry.variables); previous.groups.push(group); hosts.set(entry.address, previous);
    }
  }
  return groups.get("singbox_nodes").map((entry) => {
    const host = hosts.get(entry.address);
    return { ...(host || { address: entry.address, variables: {}, groups: [], line: entry.line, unknown: true }), variables: { ...(host?.variables || {}), ...entry.variables }, sourceLine: entry.line, definitionLine: host?.line };
  }).map((node) => ({ ...node, name: node.variables.singbox_name || "" }));
}

function validateNodes(nodes) {
  const errors = []; const names = new Map();
  for (const node of nodes) {
    if (node.unknown) errors.push(validationError(`${node.address} 未在普通主机组中定义。`, node.sourceLine));
    if (!node.name) errors.push(validationError(`${node.address} 缺少 singbox_name。`, node.definitionLine || node.sourceLine));
    else if (!/^[A-Za-z0-9_-]+$/.test(node.name)) errors.push(validationError("singbox_name 只能使用字母、数字、-、_。", node.sourceLine));
    else if (names.has(node.name)) errors.push(validationError(`singbox_name=${node.name} 与第 ${names.get(node.name)} 行重复。`, node.sourceLine));
    else names.set(node.name, node.sourceLine);
  }
  return errors;
}

function validateTemplate(config, text) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [validationError("顶层必须是 JSON 对象。")] ;
  if (!Array.isArray(config.outbounds)) return [validationError("模板缺少 outbounds 数组。")] ;
  const errors = []; const tags = new Set();
  for (const [index, outbound] of config.outbounds.entries()) {
    const line = outboundLine(text, outbound?.tag, index);
    if (!outbound || typeof outbound !== "object") { errors.push(validationError(`outbounds[${index}] 必须是对象。`, line)); continue; }
    if (!outbound.tag || typeof outbound.tag !== "string") errors.push(validationError(`outbounds[${index}] 缺少字符串 tag。`, line));
    else if (tags.has(outbound.tag)) errors.push(validationError(`outbound tag 重复：${outbound.tag}。`, line));
    else tags.add(outbound.tag);
  }
  for (const outbound of config.outbounds) {
    if (Array.isArray(outbound.outbounds)) for (const tag of outbound.outbounds) if (!tags.has(tag)) errors.push(validationError(`${outbound.tag || "未命名 outbound"} 引用了不存在的 tag：${tag}。`, outboundLine(text, outbound.tag)));
  }
  return errors;
}

function buildTemplateSamples(outbounds, previousSamples) {
  const samples = outbounds.filter((item) => supportedTypes.has(item.type));
  const usedAliases = new Set();
  return samples.map((outbound) => {
    const previous = previousSamples.get(outbound.tag);
    const alias = previous?.alias || nextProtocolAlias(outbound.type, usedAliases);
    usedAliases.add(alias);
    return { outbound, selected: previous?.selected || false, alias, serverPort: previous?.serverPort ?? outbound.server_port ?? "" };
  });
}

function nextProtocolAlias(type, usedAliases) {
  const defaults = { shadowsocks: "ss", hysteria2: "hy2", anytls: "anytls", vless: "vless", trojan: "trojan", tuic: "tuic" };
  const base = defaults[type] || type;
  if (!usedAliases.has(base)) return base;
  let index = 2;
  while (usedAliases.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function setValidation(kind, label, stateName, errors) {
  const status = elements[`${kind}Status`]; const list = elements[`${kind}Errors`]; const input = elements[`${kind}Input`];
  status.textContent = label; status.className = `validation-state ${stateName}`; input.classList.toggle("invalid", stateName === "invalid");
  list.replaceChildren(...errors.slice(0, 4).map((error) => {
    const item = document.createElement("button"); item.type = "button"; item.className = "validation-error";
    if (error.line) { item.dataset.line = error.line; item.addEventListener("click", () => focusLine(kind, error.line)); }
    const message = document.createElement("span"); message.textContent = `${error.line ? `第 ${error.line} 行：` : ""}${error.message}`; item.append(message);
    const sourceText = error.source || (error.line ? getLineText(input.value, error.line) : "");
    if (sourceText) { const source = document.createElement("span"); source.className = "error-source"; source.textContent = sourceText.trim(); item.append(source); }
    return item;
  }));
  if (errors.length > 4) { const item = document.createElement("div"); item.textContent = `另有 ${errors.length - 4} 个问题。`; list.append(item); }
  renderLineNumbers(kind);
}

function render() { renderNodes(); renderTemplates(); renderSelectors(); renderGeneratedPreview(); }

function renderNodes() {
  elements.nodeCount.textContent = state.nodes.length;
  if (!state.nodes.length) { elements.nodes.className = "node-list empty-state"; elements.nodes.textContent = "等待有效 inventory。"; return; }
  elements.nodes.className = "node-list";
  elements.nodes.replaceChildren(...state.nodes.map((node) => {
    const valid = node.name && !node.unknown;
    const row = document.createElement("div"); row.className = `node-row${valid ? "" : " missing"}`;
    const title = document.createElement("div"); title.innerHTML = `<div class="node-name">${escapeHtml(node.name || "缺少 singbox_name")}</div>${valid ? "" : `<div class="missing-label">${node.unknown ? "未在主机组定义" : "请补充 singbox_name"}</div>`}`;
    const meta = document.createElement("div"); meta.className = "node-meta"; meta.textContent = `${node.address}${node.variables.deployment_env ? ` · ${node.variables.deployment_env}` : ""}`;
    row.append(title, meta); return row;
  }));
}

function renderTemplates() {
  elements.templateCount.textContent = state.templates.length;
  const selectedCount = state.templates.filter((sample) => sample.selected).length;
  elements.templateSelectionSummary.textContent = `已选 ${selectedCount} / 共 ${state.templates.length}`;
  renderTypeFilters();
  if (!state.templates.length) { elements.templates.className = "template-list empty-state"; elements.templates.textContent = "等待有效客户端模板。"; return; }
  const samples = state.templates.filter((sample) => {
    const query = state.templateSearch;
    const port = String(sample.serverPort ?? "");
    const matchesSearch = !query || (/^\d+$/.test(query) ? port.startsWith(query) : `${sample.outbound.tag} ${sample.outbound.type} ${sample.outbound.server || ""}`.toLowerCase().includes(query));
    return matchesSearch && (!state.selectedOnly || sample.selected) && (state.activeType === "all" || sample.outbound.type === state.activeType);
  });
  elements.templates.className = "template-list";
  if (!samples.length) { elements.templates.className = "template-list empty-state"; elements.templates.textContent = "没有匹配的协议样板。"; return; }
  elements.templates.replaceChildren(...samples.map((sample) => {
    const row = document.createElement("div"); row.className = `template-row${sample.selected ? " is-selected" : ""}`;
    const checkbox = document.createElement("input"); checkbox.className = "checkbox"; checkbox.type = "checkbox"; checkbox.checked = sample.selected;
    checkbox.addEventListener("change", () => { sample.selected = checkbox.checked; renderTemplates(); renderGeneratedPreview(); });
    const info = document.createElement("div"); info.className = "template-info";
    const title = document.createElement("button"); title.className = "template-title"; title.type = "button"; title.innerHTML = `${escapeHtml(sample.outbound.tag)} <span class="protocol">${escapeHtml(sample.outbound.type)}</span>`;
    title.addEventListener("click", () => focusTemplate(sample.outbound.tag));
    const detail = document.createElement("div"); detail.className = "template-detail"; detail.textContent = `${sample.outbound.server || "无 server"}${sample.outbound.server_port ? `:${sample.outbound.server_port}` : ""}`;
    const alias = document.createElement("label"); alias.className = "alias-field"; alias.textContent = "协议别名";
    const input = document.createElement("input"); input.className = "alias-input"; input.value = sample.alias; input.setAttribute("aria-label", `${sample.outbound.tag} 的协议别名`);
    input.addEventListener("input", () => { sample.alias = input.value.trim(); renderGeneratedPreview(); }); alias.append(input);
    const port = document.createElement("label"); port.className = "alias-field"; port.textContent = "生成端口";
    const portInput = document.createElement("input"); portInput.className = "alias-input port-input"; portInput.type = "number"; portInput.min = "1"; portInput.max = "65535"; portInput.step = "1"; portInput.value = sample.serverPort; portInput.setAttribute("aria-label", `${sample.outbound.tag} 的生成端口`);
    portInput.addEventListener("input", () => { sample.serverPort = portInput.value; renderGeneratedPreview(); }); port.append(portInput);
    info.append(title, detail, alias, port); row.append(checkbox, info); return row;
  }));
}

function renderSelectors() {
  if (!state.selectors.length) { elements.selectors.className = "selector-list empty-state"; elements.selectors.textContent = "等待有效客户端模板。"; return; }
  elements.selectors.className = "selector-list";
  elements.selectors.replaceChildren(...state.selectors.map((selector) => {
    const row = document.createElement("div"); row.className = "selector-row";
    const checkbox = document.createElement("input"); checkbox.className = "checkbox"; checkbox.type = "checkbox"; checkbox.checked = selector.selected;
    checkbox.addEventListener("change", () => { selector.selected = checkbox.checked; renderGeneratedPreview(); });
    const label = document.createElement("label"); label.textContent = selector.outbound.tag || "未命名 selector";
    const detail = document.createElement("span"); detail.className = "selector-detail"; detail.textContent = `模板中 ${selector.outbound.outbounds?.length || 0} 个引用`;
    row.append(checkbox, label, detail); return row;
  }));
}

function renderGeneratedPreview() {
  const result = generate();
  if (!result.ok) {
    elements.summary.textContent = result.error;
    elements.preview.textContent = "生成后的 JSON 会显示在这里。";
    elements.previewStatus.textContent = "等待有效配置"; elements.previewStatus.className = "validation-state neutral"; elements.downloadButton.disabled = true;
    elements.copyButton.disabled = true;
    return;
  }
  const replacementNote = result.replacedTags.length ? `；覆盖 ${result.replacedTags.length} 个旧节点` : "";
  elements.summary.textContent = `${state.nodes.length} 台机器 × ${result.sampleCount} 个样板 = ${result.tags.length} 个新 outbound；更新 ${result.selectorCount} 个 selector${replacementNote}。`;
  elements.preview.textContent = JSON.stringify(result.config, null, 2);
  elements.previewStatus.textContent = "已实时生成"; elements.previewStatus.className = "validation-state valid"; elements.downloadButton.disabled = false;
  elements.copyButton.disabled = false;
}

function generate() {
  if (!state.inventory || !state.template) return { ok: false, error: "粘贴内容通过 INI 与 JSON 校验后，预览会自动生成。" };
  if (!state.nodes.length) return { ok: false, error: "[singbox_nodes] 中没有可生成的节点。" };
  const selected = state.templates.filter((sample) => sample.selected);
  if (!selected.length) return { ok: false, error: "选择至少一个协议样板后生成预览。" };
  const aliases = new Set();
  for (const sample of selected) {
    if (!/^[A-Za-z0-9_-]+$/.test(sample.alias)) return { ok: false, error: "协议别名只能使用字母、数字、-、_。" };
    if (aliases.has(sample.alias)) return { ok: false, error: "选中的协议样板不能使用重复别名。" };
    aliases.add(sample.alias);
    if (!/^\d+$/.test(String(sample.serverPort)) || Number(sample.serverPort) < 1 || Number(sample.serverPort) > 65535) return { ok: false, error: `${sample.outbound.tag} 的生成端口必须是 1 到 65535 的整数。` };
  }
  const tags = []; const newOutbounds = []; const tagsBySource = new Map(selected.map((sample) => [sample.outbound.tag, []]));
  for (const node of state.nodes) for (const sample of selected) {
    const outbound = structuredClone(sample.outbound); outbound.tag = `${node.name}-${sample.alias}`; outbound.server = node.address; outbound.server_port = Number(sample.serverPort);
    tags.push(outbound.tag); newOutbounds.push(outbound); tagsBySource.get(sample.outbound.tag).push(outbound.tag);
  }
  const sourceTags = new Set(selected.map((sample) => sample.outbound.tag));
  const generatedTypes = new Set(supportedTypes);
  const generatedTagSet = new Set(tags);
  const replacedTags = state.template.outbounds
    .filter((outbound) => !sourceTags.has(outbound.tag) && generatedTagSet.has(outbound.tag))
    .filter((outbound) => generatedTypes.has(outbound.type))
    .map((outbound) => outbound.tag);
  const unsafeConflicts = state.template.outbounds
    .filter((outbound) => !sourceTags.has(outbound.tag) && generatedTagSet.has(outbound.tag))
    .filter((outbound) => !generatedTypes.has(outbound.type))
    .map((outbound) => `${outbound.tag}（${outbound.type || "未知类型"}）`);
  if (unsafeConflicts.length) return { ok: false, error: `生成 tag 与非代理 outbound 冲突：${unsafeConflicts.join("、")}。请修改节点名或协议别名。` };
  const replacedTagSet = new Set(replacedTags);
  const config = structuredClone(state.template); config.outbounds = config.outbounds.filter((outbound) => !sourceTags.has(outbound.tag) && !replacedTagSet.has(outbound.tag)); config.outbounds.push(...newOutbounds);
  const selectedSelectors = new Set(state.selectors.filter((selector) => selector.selected).map((selector) => selector.outbound.tag));
  for (const outbound of config.outbounds) {
    if (outbound.type === "selector" && selectedSelectors.has(outbound.tag)) { outbound.outbounds = [...tags]; outbound.default = tags[0]; }
    else if (Array.isArray(outbound.outbounds)) outbound.outbounds = outbound.outbounds.flatMap((tag) => tagsBySource.get(tag) || [tag]);
  }
  return { ok: true, config, tags, replacedTags, sampleCount: selected.length, selectorCount: selectedSelectors.size };
}

function focusTemplate(tag) {
  const text = elements.templateInput.value; const match = new RegExp(`"tag"\\s*:\\s*"${escapeRegex(tag)}"`).exec(text);
  if (!match) return;
  const start = text.lastIndexOf("{", match.index); const end = text.indexOf("\n    }", match.index);
  elements.templateInput.focus(); elements.templateInput.setSelectionRange(Math.max(0, start), end > 0 ? end + 6 : match.index + tag.length + 7);
  const before = text.slice(0, Math.max(0, start)); const line = before.split("\n").length - 1;
  const lineHeight = parseFloat(getComputedStyle(elements.templateInput).lineHeight) || 18;
  elements.templateInput.scrollTop = Math.max(0, line * lineHeight - elements.templateInput.clientHeight / 3);
}

function download() {
  const result = generate(); if (!result.ok) return;
  const blob = new Blob([JSON.stringify(result.config, null, 2) + "\n"], { type: "application/json" }); const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = "config.json"; link.click(); URL.revokeObjectURL(url);
}

async function copyPreview() {
  const result = generate();
  if (!result.ok) return;
  const content = JSON.stringify(result.config, null, 2);
  try {
    await navigator.clipboard.writeText(content);
    elements.previewStatus.textContent = "已复制到剪贴板";
    elements.previewStatus.className = "validation-state valid";
  } catch {
    elements.previewStatus.textContent = "复制失败，请手动选择 JSON";
    elements.previewStatus.className = "validation-state invalid";
  }
}

function validationError(message, line, source) { return { message, line, source }; }
function getLineText(text, line) { return text.split(/\r?\n/)[line - 1] || ""; }
function jsonErrorLine(message) { const match = /position (\d+)/.exec(message); if (!match) return undefined; return elements.templateInput.value.slice(0, Number(match[1])).split("\n").length; }
function outboundLine(text, tag, index = 0) {
  if (!tag) return undefined;
  const match = new RegExp(`"tag"\\s*:\\s*"${escapeRegex(tag)}"`).exec(text);
  return match ? text.slice(0, match.index).split("\n").length : index + 1;
}
function renderLineNumbers(kind) {
  const input = elements[`${kind}Input`]; const lines = elements[`${kind}Lines`]; const errorLines = state.errorLines[kind];
  const currentLine = input.value.slice(0, input.selectionStart).split("\n").length;
  const count = Math.max(1, input.value.split("\n").length);
  lines.replaceChildren(...Array.from({ length: count }, (_, index) => {
    const line = index + 1; const item = document.createElement("span"); item.className = `line-number${errorLines.has(line) ? " has-error" : ""}${line === currentLine ? " is-focused" : ""}`; item.textContent = line; return item;
  }));
  lines.scrollTop = input.scrollTop;
}
function focusLine(kind, line) {
  const input = elements[`${kind}Input`]; const text = input.value; const starts = text.split("\n");
  const start = starts.slice(0, Math.max(0, line - 1)).join("\n").length + (line > 1 ? 1 : 0); const end = start + (starts[line - 1] || "").length;
  input.focus(); input.setSelectionRange(start, end); const lineHeight = parseFloat(getComputedStyle(input).lineHeight) || 18.6; input.scrollTop = Math.max(0, (line - 2) * lineHeight); renderLineNumbers(kind);
}
function renderTypeFilters() {
  const types = [...new Set(state.templates.map((sample) => sample.outbound.type))];
  if (state.activeType !== "all" && !types.includes(state.activeType)) state.activeType = "all";
  const filters = [["all", "全部"], ...types.map((type) => [type, type === "shadowsocks" ? "SS" : type === "hysteria2" ? "HY2" : type.toUpperCase()])];
  elements.typeFilters.replaceChildren(...filters.map(([type, label]) => {
    const button = document.createElement("button"); button.type = "button"; button.className = `filter-button${state.activeType === type ? " is-active" : ""}`; button.textContent = label;
    button.addEventListener("click", () => { state.activeType = type; renderTemplates(); }); return button;
  }));
}
function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escapeHtml(value) { return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char])); }
