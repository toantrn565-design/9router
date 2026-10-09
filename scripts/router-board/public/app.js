"use strict";
const $ = selector => document.querySelector(selector);
let state;
let catalog = [];
let busy = false;
let signature = "";

function message(text, error = false) {
  $("#message").textContent = text;
  $("#message").className = error ? "error" : "success";
}

async function api(url, method = "GET", body) {
  const response = await fetch(url, {
    method,
    headers: method === "GET" ? {} : { "content-type": "application/json", "x-board-token": state.csrfToken },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

function options(select, current) {
  select.replaceChildren();
  for (const model of catalog) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.id;
    select.append(option);
  }
  if (current && !catalog.some(m => m.id === current)) {
    const option = document.createElement("option");
    option.value = current;
    option.textContent = `${current} (không còn trong danh sách)`;
    select.prepend(option);
  }
  if (current) select.value = current;
}

async function act(action) {
  if (busy) return;
  busy = true;
  document.body.classList.add("busy");
  try { await action(); }
  catch (error) { message(error.message, true); }
  finally { busy = false; document.body.classList.remove("busy"); }
}

function render() {
  $("#router-link").href = `${state.upstream}/dashboard/providers`;
  $("#count").textContent = `${state.panes.length} / ${state.maxWindows}`;
  $("#add-button").disabled = !catalog.length || state.panes.length >= state.maxWindows;
  $("#empty").hidden = state.panes.length > 0;
  const nextSignature = JSON.stringify([state.panes, catalog]);
  // Polling must not replace inputs while the user is typing.
  if (signature === nextSignature || $("#windows").contains(document.activeElement)) return;
  signature = nextSignature;
  const host = $("#windows");
  host.replaceChildren();
  for (const pane of state.panes) {
    const locked = pane.running || pane.activeRequests > 0;
    const card = document.createElement("article");
    card.className = "window";
    const heading = document.createElement("h3");
    heading.textContent = pane.name;
    const status = document.createElement("span");
    status.className = pane.running ? "badge running" : "badge";
    status.textContent = pane.running ? "Đang mở" : "Đã đóng";
    const top = document.createElement("div");
    top.className = "card-top";
    top.append(heading, status);
    const form = document.createElement("form");
    const fields = {};
    for (const [name, title] of [["name", "Tên cửa sổ"], ["model", "Model"], ["folder", "Thư mục làm việc"]]) {
      const label = document.createElement("label");
      label.append(document.createTextNode(title));
      const input = document.createElement(name === "model" ? "select" : "input");
      input.name = name;
      input.required = true;
      if (name === "model") options(input, pane.model);
      else input.value = pane[name];
      if (name === "name") input.maxLength = 80;
      input.disabled = locked;
      fields[name] = input;
      label.append(input);
      form.append(label);
    }
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "secondary";
    save.textContent = "Lưu thay đổi";
    save.disabled = locked;
    form.append(save);
    form.addEventListener("submit", event => {
      event.preventDefault();
      act(async () => {
        state = await api(`/api/windows/${pane.id}`, "PATCH", Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value])));
        document.activeElement.blur(); render(); message("Đã lưu cấu hình cửa sổ.");
      });
    });
    const endpoint = document.createElement("code");
    endpoint.textContent = pane.baseUrl;
    const activity = document.createElement("p");
    activity.className = "activity";
    activity.textContent = `${pane.activeRequests} yêu cầu đang chạy · Cổng ${pane.port}`;
    const actions = document.createElement("div");
    actions.className = "actions";
    const open = document.createElement("button");
    open.textContent = "Mở cửa sổ Codex";
    open.disabled = pane.running || !catalog.some(m => m.id === pane.model) || state.platform !== "win32";
    open.addEventListener("click", () => act(async () => {
      const selected = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value]));
      if (Object.entries(selected).some(([key, value]) => value !== pane[key])) {
        state = await api(`/api/windows/${pane.id}`, "PATCH", selected);
      }
      state = await api(`/api/windows/${pane.id}/open`, "POST", {});
      document.activeElement.blur(); render(); message(`Đã mở ${pane.name}.`);
    }));
    const close = document.createElement("button");
    close.className = "secondary";
    close.textContent = "Đóng cửa sổ";
    close.disabled = !pane.running;
    close.addEventListener("click", () => {
      if (!confirm(`Đóng ${pane.name}? Phiên Codex và các tác vụ trong cửa sổ này sẽ bị dừng. Hãy lưu công việc trước.`)) return;
      act(async () => {
        state = await api(`/api/windows/${pane.id}/close`, "POST", {});
        document.activeElement.blur(); render(); message("Đã đóng cửa sổ.");
      });
    });
    const remove = document.createElement("button");
    remove.className = "danger";
    remove.textContent = "Xóa";
    remove.disabled = locked;
    remove.addEventListener("click", () => {
      if (!confirm(`Xóa cấu hình ${pane.name}?`)) return;
      act(async () => {
        state = await api(`/api/windows/${pane.id}`, "DELETE");
        document.activeElement.blur(); render(); message("Đã xóa cấu hình và giải phóng cổng.");
      });
    });
    actions.append(open, close, remove);
    card.append(top, form, endpoint, activity, actions);
    host.append(card);
  }
}

async function loadModels(refresh = false) {
  const value = $("#new-model").value;
  catalog = (await api(`/api/models${refresh ? "?refresh=1" : ""}`)).models;
  options($("#new-model"), catalog.some(m => m.id === value) ? value : undefined);
  render();
  if (!catalog.length) message("Chưa có model. Mở Quản lý tài khoản → Providers → Codex → Add Connection, rồi cập nhật danh sách.", true);
}

$("#add-form").addEventListener("submit", event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  act(async () => {
    state = await api("/api/windows", "POST", values);
    $("#add-form").elements.name.value = "";
    render(); message("Đã thêm cửa sổ. Bấm Mở cửa sổ Codex để bắt đầu.");
  });
});
$("#refresh-models").addEventListener("click", () => act(async () => { await loadModels(true); if (catalog.length) message("Đã cập nhật danh sách model."); }));
$("#windows").addEventListener("focusout", () => setTimeout(render, 0));

async function initialize() {
  try { state = await api("/api/state"); render(); await loadModels(); }
  catch (error) { message(error.message, true); }
  setInterval(async () => {
    if (busy) return;
    try { state = await api("/api/state"); render(); }
    catch { message("Mất kết nối Router Board. Mở lại bằng shortcut trên Desktop.", true); }
  }, 2000);
}
initialize();
