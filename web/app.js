/* MuleSoft Secure Properties Tool - client-side implementation.
 *
 * Mirrors the secure-properties-tool.jar behavior:
 *   - key bytes come from the raw UTF-8 key string
 *   - all-zero IV of block size (ignored for ECB)
 *   - PKCS5/PKCS7 padding
 *   - output is Base64
 */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const state = { op: "encrypt", method: "string", file: null, view: "crypto" };

  const ALGO_META = {
    AES:      { blockSize: 16, validKeySizes: [16, 24, 32], label: "16, 24, or 32 bytes" },
    Blowfish: { blockSize: 8,  validKeySizes: null,          label: "4 to 56 bytes" },
    DES:      { blockSize: 8,  validKeySizes: [8],           label: "8 bytes" },
    DESede:   { blockSize: 8,  validKeySizes: [16, 24],      label: "16 or 24 bytes" },
  };

  const MODE_MAP = {
    CBC: CryptoJS.mode.CBC,
    CFB: CryptoJS.mode.CFB,
    ECB: CryptoJS.mode.ECB,
    OFB: CryptoJS.mode.OFB,
  };

  // ---------- UI wiring ----------

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => setOp(btn.dataset.tab));
  });

  document.querySelectorAll(".seg").forEach((btn) => {
    btn.addEventListener("click", () => setMethod(btn.dataset.method));
  });

  $("algorithm").addEventListener("change", refreshKeyHint);
  $("key").addEventListener("input", refreshKeyHint);
  $("mode").addEventListener("change", refreshIvControl);
  $("randomIv").addEventListener("change", refreshIvControl);
  $("input").addEventListener("input", refreshRunState);
  $("key").addEventListener("input", refreshRunState);
  $("themeToggle").addEventListener("click", toggleTheme);
  $("toggleKey").addEventListener("click", () => {
    const k = $("key");
    const isPwd = k.type === "password";
    k.type = isPwd ? "text" : "password";
    const useEl = $("toggleKey").querySelector("use");
    useEl.setAttribute("href", isPwd ? "#i-eye-slash" : "#i-eye");
  });
  $("clearBtn").addEventListener("click", () => {
    $("input").value = "";
    $("output").value = "";
    setStatus("");
    refreshRunState();
  });
  $("copyBtn").addEventListener("click", copyOutput);
  $("cryptoForm").addEventListener("submit", onSubmit);

  // File mode
  $("dropzone").addEventListener("click", () => $("fileInput").click());
  $("dropzone").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("fileInput").click(); }
  });
  ["dragenter", "dragover"].forEach((ev) =>
    $("dropzone").addEventListener(ev, (e) => { e.preventDefault(); $("dropzone").classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    $("dropzone").addEventListener(ev, (e) => { e.preventDefault(); $("dropzone").classList.remove("dragover"); })
  );
  $("dropzone").addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  $("fileInput").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadFile(f);
  });
  $("clearFileBtn").addEventListener("click", clearFile);
  $("downloadBtn").addEventListener("click", downloadOutput);
  $("previewBtn").addEventListener("click", openFilePreview);

  // Restore tab from URL hash (e.g. #inspect, #crypto/encrypt). Falls back
  // to defaults when the hash is empty or invalid.
  const initial = parseHash();
  setOp(initial.op);
  setMethod("string");
  refreshKeyHint();
  refreshIvControl();
  refreshRunState();
  updateThemeToggleLabel();

  // View switcher (Crypto vs Inspect)
  document.querySelectorAll(".view-tab").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  setView(initial.view);

  // Keep tabs in sync when the user navigates with browser back/forward or
  // edits the hash manually.
  window.addEventListener("hashchange", () => {
    const parsed = parseHash();
    setView(parsed.view, { skipHash: true });
    setOp(parsed.op, { skipHash: true });
  });

  function parseHash() {
    const raw = (location.hash || "").replace(/^#/, "").toLowerCase();
    const [slug, op] = raw.split("/");
    const validOps = ["encrypt", "decrypt"];
    // URL uses "secure" as the friendly name for the crypto view.
    const view = slug === "inspect" ? "inspect" : "crypto";
    return {
      view,
      op: validOps.includes(op) ? op : "encrypt",
    };
  }

  function updateHash() {
    const view = state.view || "crypto";
    const hash = view === "crypto" ? `#secure/${state.op}` : `#${view}`;
    if (location.hash !== hash) {
      // Use replaceState to avoid spamming history with every tab switch.
      history.replaceState(null, "", hash);
    }
  }

  function setView(view, options) {
    state.view = view;
    document.querySelectorAll(".view-tab").forEach((b) => {
      const active = b.dataset.view === view;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", active);
    });
    $("cryptoView").hidden = view !== "crypto";
    $("inspectView").hidden = view !== "inspect";
    $("infoCrypto").hidden = view !== "crypto";
    $("infoInspect").hidden = view !== "inspect";
    document.body.classList.toggle("view-inspect", view === "inspect");
    if (view !== "inspect") {
      document.body.classList.remove("inspect-fullscreen");
      document.body.classList.remove("inspect-wide");
    } else if (!$("inspectResults").hidden) {
      // Re-entering inspect with results already rendered — restore wide layout
      document.body.classList.add("inspect-wide");
    }
    if (!options || !options.skipHash) updateHash();
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (_) {}
    updateThemeToggleLabel();
  }

  function updateThemeToggleLabel() {
    const theme = document.documentElement.getAttribute("data-theme") || "light";
    const btn = $("themeToggle");
    const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
  }

  // ---------- handlers ----------

  function setOp(op, options) {
    state.op = op;
    document.querySelectorAll(".tab").forEach((b) => {
      const active = b.dataset.tab === op;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", active);
    });
    $("inputLabel").textContent = op === "encrypt" ? "Plain value" : "Encrypted value (Base64)";
    $("outputLabel").textContent = op === "encrypt" ? "Encrypted value (Base64)" : "Plain value";
    $("input").placeholder = op === "encrypt" ? "Type the value to encrypt…" : "Paste the Base64 ciphertext…";

    const runBtn = $("runBtn");
    runBtn.querySelector("span").textContent = op === "encrypt" ? "Encrypt" : "Decrypt";
    runBtn.querySelector("use").setAttribute("href", op === "encrypt" ? "#i-lock-closed" : "#i-lock-open");

    const runFileBtn = $("runFileBtn");
    runFileBtn.querySelector("span").textContent = op === "encrypt" ? "Encrypt file" : "Decrypt file";
    runFileBtn.querySelector("use").setAttribute("href", op === "encrypt" ? "#i-lock-closed" : "#i-lock-open");

    $("output").value = "";
    $("fileOutput").value = "";
    refreshRunState();
    setStatus("");
    setFileStatus("");
    if (!options || !options.skipHash) updateHash();
  }

  function setMethod(method) {
    state.method = method;
    document.querySelectorAll(".seg").forEach((b) => {
      const active = b.dataset.method === method;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", active);
    });
    $("stringPanel").hidden = method !== "string";
    $("filePanel").hidden = method !== "file";
    $("methodHint").textContent = method === "string"
      ? "Encrypt or decrypt a single value."
      : "Process a .properties or .yaml file, value by value.";
  }

  function refreshKeyHint() {
    const algo = $("algorithm").value;
    const meta = ALGO_META[algo];
    const keyBytes = new TextEncoder().encode($("key").value).length;
    $("algoHint").textContent = `Key size: ${meta.label}`;
    $("keyHint").textContent = keyBytes
      ? `Current key length: ${keyBytes} byte${keyBytes === 1 ? "" : "s"}`
      : "";
  }

  function refreshIvControl() {
    const mode = $("mode").value;
    const cb = $("randomIv");
    const hint = $("ivHint");
    if (mode === "ECB") {
      cb.checked = false;
      cb.disabled = true;
      hint.textContent = "ECB does not use an IV.";
      return;
    }
    cb.disabled = false;
    if (cb.checked) {
      hint.textContent = "A random IV is generated and prepended to the ciphertext (first block) in Base64.";
    } else {
      hint.textContent = "IV defaults to the key bytes (truncated or zero-padded to the block size).";
    }
  }

  // Enable/disable the Encrypt/Decrypt and Copy buttons based on what's
  // required. String mode needs a key + an input value; file mode needs a
  // key + a loaded file. Copy is enabled only when the associated output
  // field actually holds a value.
  function refreshRunState() {
    const hasKey = $("key").value.length > 0;
    const hasInput = $("input").value.length > 0;
    const hasOutput = $("output").value.length > 0;
    const hasFileOutput = $("fileOutput").value.length > 0;
    $("runBtn").disabled = !(hasKey && hasInput);
    $("runFileBtn").disabled = !(hasKey && state.file);
    $("copyBtn").disabled = !hasOutput;
    $("downloadBtn").disabled = !hasFileOutput;
    $("previewBtn").disabled = !hasFileOutput;
  }

  function onSubmit(e) {
    e.preventDefault();
    if (state.method === "file") return onSubmitFile();
    setStatus("");
    const algo = $("algorithm").value;
    const mode = $("mode").value;
    const key = $("key").value;
    const value = $("input").value;
    const randomIv = $("randomIv").checked;

    if (!key) return setStatus("Please provide a key.", "error");
    if (!value) return setStatus("Please provide a value.", "error");

    const keyErr = validateKey(algo, key);
    if (keyErr) return setStatus(keyErr, "error");

    try {
      const result = state.op === "encrypt"
        ? encrypt(algo, mode, key, value, { randomIv })
        : decrypt(algo, mode, key, value, { randomIv });
      $("output").value = result;
      setStatus(state.op === "encrypt" ? "Encrypted." : "Decrypted.", "ok");
    } catch (err) {
      $("output").value = "";
      setStatus(err.message || "Operation failed.", "error");
    }
    refreshRunState();
  }

  function validateKey(algo, key) {
    const meta = ALGO_META[algo];
    const keyBytes = new TextEncoder().encode(key).length;
    if (meta.validKeySizes && !meta.validKeySizes.includes(keyBytes)) {
      return `Invalid key size for ${algo}. Expected ${meta.validKeySizes.join(" / ")} bytes, got ${keyBytes}.`;
    }
    if (algo === "Blowfish" && (keyBytes < 4 || keyBytes > 56)) {
      return `Blowfish key must be 4 to 56 bytes (got ${keyBytes}).`;
    }
    return null;
  }

  async function copyOutput() {
    const text = $("output").value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied to clipboard.", "ok");
    } catch {
      setStatus("Could not copy to clipboard.", "error");
    }
  }

  // ---------- file mode ----------

  function loadFile(file) {
    state.file = file;
    const reader = new FileReader();
    reader.onload = () => {
      state.fileContent = reader.result;
      $("fileInfo").textContent = `${file.name} · ${formatBytes(file.size)}`;
      $("dropzoneTitle").textContent = file.name;
      $("dropzone").classList.add("has-file");
      $("fileOutput").value = "";
      $("downloadBtn").disabled = true;
      refreshRunState();
      setFileStatus(`Loaded ${file.name}.`, "ok");
    };
    reader.onerror = () => setFileStatus("Could not read file.", "error");
    reader.readAsText(file);
  }

  function clearFile() {
    state.file = null;
    state.fileContent = "";
    $("fileInput").value = "";
    $("fileInfo").textContent = "";
    $("dropzoneTitle").textContent = "Drop a .properties or .yaml file here";
    $("dropzone").classList.remove("has-file");
    $("fileOutput").value = "";
    $("downloadBtn").disabled = true;
    refreshRunState();
    setFileStatus("");
  }

  function onSubmitFile() {
    setFileStatus("");
    const algo = $("algorithm").value;
    const mode = $("mode").value;
    const key = $("key").value;
    const randomIv = $("randomIv").checked;

    if (!key) return setFileStatus("Please provide a key.", "error");
    if (!state.file || state.fileContent == null) return setFileStatus("Please select a file.", "error");

    const keyErr = validateKey(algo, key);
    if (keyErr) return setFileStatus(keyErr, "error");

    const format = detectFormat(state.file.name);
    try {
      const { output, processed, skipped } = transformFile(state.fileContent, format, algo, mode, key, state.op, { randomIv });
      $("fileOutput").value = output;
      const action = state.op === "encrypt" ? "Encrypted" : "Decrypted";
      const skippedMsg = skipped ? `, ${skipped} skipped` : "";
      setFileStatus(`${action} ${processed} value${processed === 1 ? "" : "s"}${skippedMsg}.`, "ok");
    } catch (err) {
      $("fileOutput").value = "";
      setFileStatus(err.message || "Operation failed.", "error");
    }
    refreshRunState();
  }

  function downloadOutput() {
    const content = $("fileOutput").value;
    if (!content || !state.file) return;
    const base = state.file.name.replace(/(\.[^.]+)?$/, "");
    const ext = (state.file.name.match(/\.[^.]+$/) || [""])[0];
    const suffix = state.op === "encrypt" ? ".encrypted" : ".decrypted";
    const filename = `${base}${suffix}${ext}`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function detectFormat(name) {
    const lower = name.toLowerCase();
    if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
    return "properties";
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  // Transform each line of a .properties or .yaml file. Only non-comment
  // lines containing a key=value or key: value pair are processed.
  // YAML sequence items (- value) are also processed.
  // Ciphertext is wrapped with ![...] on encrypt, and stripped on decrypt.
  function transformFile(content, format, algo, mode, key, op, options) {
    const lines = content.split(/\r?\n/);
    const out = new Array(lines.length);
    let processed = 0;
    let skipped = 0;

    const separator = format === "yaml" ? /^(\s*)([^:#\s][^:]*?)\s*:\s*(.*)$/ : /^(\s*)([^=:#\s][^=:]*?)\s*([=:])\s*(.*)$/;
    const seqItemRe = /^(\s*-\s?)(.+)$/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Comments & blanks pass through
      if (!line.trim() || /^\s*[#!]/.test(line)) { out[i] = line; continue; }

      const m = line.match(separator);

      // YAML sequence items: "  - value"
      if (!m && format === "yaml") {
        const seqMatch = line.match(seqItemRe);
        if (seqMatch) {
          const prefix = seqMatch[1];
          let value = seqMatch[2];

          // Strip trailing inline comment
          let trailing = "";
          const hashIdx = findUnquotedHash(value);
          if (hashIdx >= 0) {
            trailing = value.slice(hashIdx);
            value = value.slice(0, hashIdx).replace(/\s+$/, "");
          }

          // Unwrap quotes
          let quote = "";
          if (value.length >= 2) {
            const first = value[0], last = value[value.length - 1];
            if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
              quote = first;
              value = value.slice(1, -1);
            }
          }

          if (value === "") { out[i] = line; skipped++; continue; }

          try {
            let newValue;
            if (op === "encrypt") {
              const encrypted = encrypt(algo, mode, key, unwrapSecure(value).value, options);
              newValue = `![${encrypted}]`;
            } else {
              const inner = unwrapSecure(value);
              if (!inner.wrapped) { out[i] = line; skipped++; continue; }
              newValue = decrypt(algo, mode, key, inner.value, options);
            }
            const wrapped = quote ? `${quote}${newValue}${quote}` : newValue;
            out[i] = `${prefix}${wrapped}${trailing ? " " + trailing : ""}`;
            processed++;
          } catch (err) {
            throw new Error(`Line ${i + 1}: ${err.message}`);
          }
          continue;
        }
      }

      if (!m) { out[i] = line; continue; }

      let prefix, rawValue;
      if (format === "yaml") {
        const [, indent, k, v] = m;
        prefix = `${indent}${k}: `;
        rawValue = v;
      } else {
        const [, indent, k, sep, v] = m;
        prefix = `${indent}${k}${sep}`;
        // properties allow optional whitespace after the separator; preserve none here to match tool output
        rawValue = v;
      }

      // Strip trailing inline comments only for YAML (properties treat # mid-line as literal)
      let value = rawValue;
      let trailing = "";
      if (format === "yaml") {
        const hashIdx = findUnquotedHash(value);
        if (hashIdx >= 0) {
          trailing = value.slice(hashIdx);
          value = value.slice(0, hashIdx).replace(/\s+$/, "");
        }
      }

      // Unwrap quotes (YAML only) while remembering the style
      let quote = "";
      if (format === "yaml" && value.length >= 2) {
        const first = value[0], last = value[value.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
          quote = first;
          value = value.slice(1, -1);
        }
      }

      if (value === "") { out[i] = line; skipped++; continue; }

      try {
        let newValue;
        if (op === "encrypt") {
          const encrypted = encrypt(algo, mode, key, unwrapSecure(value).value, options);
          newValue = `![${encrypted}]`;
        } else {
          const inner = unwrapSecure(value);
          if (!inner.wrapped) { out[i] = line; skipped++; continue; }
          newValue = decrypt(algo, mode, key, inner.value, options);
        }
        const wrapped = quote ? `${quote}${newValue}${quote}` : newValue;
        out[i] = `${prefix}${wrapped}${trailing ? " " + trailing : ""}`;
        processed++;
      } catch (err) {
        throw new Error(`Line ${i + 1}: ${err.message}`);
      }
    }

    return { output: out.join("\n"), processed, skipped };
  }

  function unwrapSecure(value) {
    const m = value.match(/^!\[(.*)\]$/);
    if (m) return { wrapped: true, value: m[1] };
    return { wrapped: false, value };
  }

  function findUnquotedHash(s) {
    let inSingle = false, inDouble = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "'" && !inDouble) inSingle = !inSingle;
      else if (c === '"' && !inSingle) inDouble = !inDouble;
      else if (c === "#" && !inSingle && !inDouble) {
        // require whitespace before # to count as a comment
        if (i === 0 || /\s/.test(s[i - 1])) return i;
      }
    }
    return -1;
  }

  function setStatus(msg, kind) {
    writeStatus($("status"), msg, kind);
  }

  function setFileStatus(msg, kind) {
    writeStatus($("fileStatus"), msg, kind);
  }

  function writeStatus(el, msg, kind) {
    if (!msg) {
      el.textContent = "";
      el.className = "status";
      return;
    }
    el.className = "status visible" + (kind ? " " + kind : "");
    const iconId = kind === "error" ? "#i-exclamation-triangle"
                 : kind === "ok"    ? "#i-check"
                                    : "#i-information-circle";
    el.innerHTML = `<svg class="icon"><use href="${iconId}"/></svg><span></span>`;
    el.querySelector("span").textContent = msg;
  }

  // ---------- crypto ----------

  function keyWordArray(algo, key) {
    const raw = CryptoJS.enc.Utf8.parse(key);
    // Triple DES in CryptoJS expects a 24-byte key. A 16-byte "two-key"
    // 3DES key is expanded by repeating the first 8 bytes (JCE behavior).
    if (algo === "DESede" && raw.sigBytes === 16) {
      const words = raw.words.slice();
      words.push(raw.words[0], raw.words[1]); // append first 8 bytes
      return CryptoJS.lib.WordArray.create(words, 24);
    }
    return raw;
  }

  function zeroIv(blockSize) {
    const words = new Array(blockSize / 4).fill(0);
    return CryptoJS.lib.WordArray.create(words, blockSize);
  }

  // Build an IV of blockSize bytes from the raw key bytes: truncate if the
  // key is longer, zero-pad if shorter. Matches the "IV = key" convention
  // some Mule configs use with the secure-properties-tool.
  function keyDerivedIv(key, blockSize) {
    const full = CryptoJS.enc.Utf8.parse(key);
    const words = new Array(blockSize / 4).fill(0);
    const bytesToCopy = Math.min(full.sigBytes, blockSize);
    for (let i = 0; i < bytesToCopy; i++) {
      const b = (full.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
      words[i >>> 2] |= b << (24 - (i % 4) * 8);
    }
    return CryptoJS.lib.WordArray.create(words, blockSize);
  }

  function randomIv(blockSize) {
    return CryptoJS.lib.WordArray.random(blockSize);
  }

  function cipherFor(algo) {
    switch (algo) {
      case "AES":      return CryptoJS.AES;
      case "Blowfish": return CryptoJS.Blowfish;
      case "DES":      return CryptoJS.DES;
      case "DESede":   return CryptoJS.TripleDES;
      default: throw new Error("Unsupported algorithm: " + algo);
    }
  }

  function encrypt(algo, mode, key, value, options) {
    const cipher = cipherFor(algo);
    const meta = ALGO_META[algo];
    const useRandom = !!(options && options.randomIv) && mode !== "ECB";
    const iv = mode === "ECB"
      ? zeroIv(meta.blockSize)
      : useRandom ? randomIv(meta.blockSize) : keyDerivedIv(key, meta.blockSize);

    const cfg = {
      mode: MODE_MAP[mode],
      padding: CryptoJS.pad.Pkcs7,
      iv,
    };
    const out = cipher.encrypt(CryptoJS.enc.Utf8.parse(value), keyWordArray(algo, key), cfg);

    if (useRandom) {
      // Prepend the IV so decryption can recover it.
      const combined = iv.clone();
      combined.concat(out.ciphertext);
      return combined.toString(CryptoJS.enc.Base64);
    }
    return out.ciphertext.toString(CryptoJS.enc.Base64);
  }

  function decrypt(algo, mode, key, value, options) {
    const cipher = cipherFor(algo);
    const meta = ALGO_META[algo];
    const useRandom = !!(options && options.randomIv) && mode !== "ECB";

    let data = CryptoJS.enc.Base64.parse(value.trim());
    let iv;

    if (mode === "ECB") {
      iv = zeroIv(meta.blockSize);
    } else if (useRandom) {
      if (data.sigBytes < meta.blockSize) {
        throw new Error("Ciphertext is too short to contain an IV.");
      }
      iv = CryptoJS.lib.WordArray.create(data.words.slice(0, meta.blockSize / 4), meta.blockSize);
      const rest = CryptoJS.lib.WordArray.create(
        data.words.slice(meta.blockSize / 4),
        data.sigBytes - meta.blockSize
      );
      data = rest;
    } else {
      iv = keyDerivedIv(key, meta.blockSize);
    }

    const cfg = {
      mode: MODE_MAP[mode],
      padding: CryptoJS.pad.Pkcs7,
      iv,
    };
    const params = CryptoJS.lib.CipherParams.create({ ciphertext: data });
    const decrypted = cipher.decrypt(params, keyWordArray(algo, key), cfg);
    let plain;
    try {
      plain = decrypted.toString(CryptoJS.enc.Utf8);
    } catch {
      throw new Error("Decryption failed. Check the key, algorithm, mode, and IV option.");
    }
    if (!plain && value) {
      throw new Error("Decryption failed. Check the key, algorithm, mode, and IV option.");
    }
    return plain;
  }

  // ==========================================================================
  // Properties Inspector
  // ==========================================================================

  const inspector = {
    files: [],           // { name, content, format, env, secure }
    envs: new Map(),     // env -> { plainFiles, secureFiles, config }
    envOrder: [],        // display order (drag-and-drop); seeded by load order
    results: null,       // { keys, envs, rows }
    revealed: new Set(), // per-cell reveal: `${key}|${env}`
  };

  // Wire up inspector UI
  $("pickFilesBtn").addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); $("inspectFileInput").click(); });
  $("pickFolderBtn").addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); $("inspectFolderInput").click(); });
  $("inspectFileInput").addEventListener("change", (e) => addFiles(Array.from(e.target.files || [])));
  $("inspectFolderInput").addEventListener("change", (e) => addFiles(Array.from(e.target.files || [])));

  const idz = $("inspectDropzone");
  idz.addEventListener("click", () => $("inspectFileInput").click());
  idz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("inspectFileInput").click(); }
  });
  ["dragenter", "dragover"].forEach((ev) =>
    idz.addEventListener(ev, (e) => { e.preventDefault(); idz.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    idz.addEventListener(ev, (e) => { e.preventDefault(); idz.classList.remove("dragover"); })
  );
  idz.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    if (!dt) return;

    // Grab the flat file list synchronously — works for both files and
    // "files inside folders that browsers flatten" drops. It's empty when
    // a real directory is dropped, which is when we need the entry walk.
    const dtFiles = Array.from(dt.files || []);

    const items = dt.items;
    const hasEntries = items && items.length && items[0].webkitGetAsEntry;

    if (!hasEntries) return addFiles(dtFiles);

    // Check if any item is a directory — only then do we need the async walk.
    const entries = [];
    let hasDirectory = false;
    for (const it of items) {
      const entry = it.webkitGetAsEntry && it.webkitGetAsEntry();
      if (!entry) continue;
      entries.push(entry);
      if (entry.isDirectory) hasDirectory = true;
    }

    if (!hasDirectory) return addFiles(dtFiles);

    const files = [];
    Promise.all(entries.map((entry) => readEntry(entry, files))).then(() => {
      // Merge what the entry walk found with the flat list, dedupe by name.
      const seen = new Set();
      const merged = [];
      for (const f of [...files, ...dtFiles]) {
        if (seen.has(f.name)) continue;
        seen.add(f.name);
        merged.push(f);
      }
      addFiles(merged);
    });
  });

  $("envPattern").addEventListener("input", reclassifyFiles);
  $("securePattern").addEventListener("input", reclassifyFiles);
  $("analyzeBtn").addEventListener("click", analyzeEnvs);
  $("clearInspectBtn").addEventListener("click", clearInspector);
  $("inspectFilter").addEventListener("input", renderTable);
  $("missingOnly").addEventListener("change", renderTable);
  $("diffOnly").addEventListener("change", renderTable);
  $("revealAll").addEventListener("change", renderTable);
  $("fullscreenBtn").addEventListener("click", () => setFullscreen(!document.body.classList.contains("inspect-fullscreen")));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("inspect-fullscreen")) {
      setFullscreen(false);
    } else if ((e.key === "f" || e.key === "F") && !$("inspectResults").hidden) {
      const tag = (e.target && e.target.tagName) || "";
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      setFullscreen(!document.body.classList.contains("inspect-fullscreen"));
    }
  });

  // Value dialog
  $("valueDialogClose").addEventListener("click", () => $("valueDialog").close());
  $("valueDialogDismiss").addEventListener("click", () => $("valueDialog").close());
  $("valueDialog").addEventListener("click", (e) => {
    // Clicking the backdrop (i.e. the dialog element itself, not its contents) closes
    if (e.target === $("valueDialog")) $("valueDialog").close();
  });
  $("valueDialogCopy").addEventListener("click", copyDialogValue);

  function setFullscreen(on) {
    document.body.classList.toggle("inspect-fullscreen", on);
    const btn = $("fullscreenBtn");
    btn.querySelector("span").textContent = on ? "Exit fullscreen" : "Fullscreen";
    btn.querySelector("use").setAttribute("href", on ? "#i-arrows-collapse" : "#i-arrows-expand");
    btn.title = on ? "Exit fullscreen (Esc or F)" : "Fullscreen (press F or Esc to exit)";
  }

  function readEntry(entry, files) {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file((f) => { files.push(f); resolve(); }, () => resolve());
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const walk = () => {
          reader.readEntries((entries) => {
            if (!entries.length) return resolve();
            Promise.all(entries.map((e) => readEntry(e, files))).then(walk);
          }, () => resolve());
        };
        walk();
      } else resolve();
    });
  }

  function addFiles(fileList) {
    const accepted = fileList.filter((f) => /\.(properties|ya?ml|txt)$/i.test(f.name));
    if (!accepted.length) {
      setInspectStatus("No supported files found. Use .properties, .yaml, or .yml.", "error");
      return;
    }
    const readers = accepted.map(
      (f) =>
        new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve({ name: f.name, content: String(r.result || "") });
          r.onerror = () => resolve(null);
          r.readAsText(f);
        })
    );
    Promise.all(readers).then((entries) => {
      for (const e of entries) {
        if (!e) continue;
        // Avoid duplicates by name
        if (inspector.files.some((x) => x.name === e.name)) continue;
        inspector.files.push({ name: e.name, content: e.content });
      }
      reclassifyFiles();
    });
  }

  function reclassifyFiles() {
    const envRx = patternToRegex($("envPattern").value);
    const secRx = patternToRegex($("securePattern").value);

    // First pass: classify each file by trying the secure pattern first,
    // then the plain env pattern. Files matching neither are kept but
    // marked as "unmatched".
    const envs = new Map();
    for (const f of inspector.files) {
      f.format = detectFormat(f.name);
      const secMatch = secRx && matchName(f.name, secRx);
      const envMatch = envRx && matchName(f.name, envRx);
      if (secMatch) {
        f.env = secMatch;
        f.secure = true;
      } else if (envMatch) {
        f.env = envMatch;
        f.secure = false;
      } else {
        f.env = null;
        f.secure = false;
      }
      if (f.env) {
        if (!envs.has(f.env)) {
          envs.set(f.env, {
            plainFiles: [],
            secureFiles: [],
            config: { key: "", algo: "AES", mode: "CBC", randomIv: false, show: false },
          });
        }
        const bucket = envs.get(f.env);
        (f.secure ? bucket.secureFiles : bucket.plainFiles).push(f);
      }
    }

    // Preserve existing per-env config where the env still exists
    for (const [name, bucket] of envs) {
      const prev = inspector.envs.get(name);
      if (prev) bucket.config = prev.config;
    }

    inspector.envs = envs;

    // Track display order. New envs are appended in load order; removed
    // envs fall out. The user can drag-and-drop to reorder at any time.
    inspector.envOrder = inspector.envOrder.filter((e) => envs.has(e));
    for (const name of envs.keys()) {
      if (!inspector.envOrder.includes(name)) inspector.envOrder.push(name);
    }

    renderEnvList();
    $("analyzeBtn").disabled = envs.size === 0;
  }

  // Convert "config-{env}.properties" into a case-insensitive regex with a
  // capturing group named "env". If the string already contains parens or a
  // "(?<env>...)" group, treat it as a literal regex.
  function patternToRegex(pattern) {
    if (!pattern || !pattern.trim()) return null;
    const p = pattern.trim();
    try {
      if (/\(\?<env>/.test(p)) return new RegExp("^" + p + "$", "i");
      if (p.includes("{env}")) {
        const escaped = p.replace(/[.+^$|()[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\{env\}/, "(?<env>[A-Za-z0-9._-]+)");
        return new RegExp("^" + escaped + "$", "i");
      }
      // Fallback: treat as raw regex
      return new RegExp("^" + p + "$", "i");
    } catch (_) {
      return null;
    }
  }

  function matchName(name, rx) {
    const m = name.match(rx);
    if (!m) return null;
    return (m.groups && m.groups.env) || m[1] || null;
  }

  // Env names in drag-and-drop order (falls back to envs Map iteration
  // order, which is load order).
  function orderedEnvNames() {
    return inspector.envOrder.filter((e) => inspector.envs.has(e));
  }

  // Re-arrange columns in `inspector.results` to match the current order,
  // without re-running decryption.
  function reorderResults() {
    if (!inspector.results) return;
    const newOrder = orderedEnvNames();
    const oldEnvs = inspector.results.envs;
    const map = newOrder.map((e) => oldEnvs.indexOf(e)).filter((i) => i >= 0);
    for (let i = 0; i < oldEnvs.length; i++) if (!map.includes(i)) map.push(i);
    const mappedEnvs = map.map((i) => oldEnvs[i]);
    const rows = inspector.results.rows.map((r) => ({
      ...r,
      cells: map.map((i) => r.cells[i]),
    }));
    inspector.results = { ...inspector.results, envs: mappedEnvs, rows };
  }

  function renderEnvList() {
    const host = $("envList");
    const panel = $("envListPanel");
    host.innerHTML = "";

    const unmatched = inspector.files.filter((f) => !f.env);
    if (!inspector.envs.size && !unmatched.length) {
      if (panel) panel.hidden = true;
      host.hidden = true;
      return;
    }
    if (panel) panel.hidden = false;
    host.hidden = false;

    host.classList.add("env-list-draggable");

    const envNames = orderedEnvNames();
    for (const envName of envNames) {
      const bucket = inspector.envs.get(envName);
      const hasSecure = bucket.secureFiles.length > 0;
      const item = document.createElement("div");
      item.className = "env-item";
      item.dataset.env = envName;
      item.setAttribute("draggable", "true");
      item.innerHTML = `
        <div class="env-item-header">
          <div class="env-name">
            <span class="env-drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
            <span>${escapeHtml(envName)}</span>
            ${hasSecure ? '<span class="env-badge secure">secure</span>' : ""}
            <span class="env-badge">${bucket.plainFiles.length + bucket.secureFiles.length} file(s)</span>
          </div>
          <button type="button" class="env-remove" data-env="${escapeAttr(envName)}" title="Remove">
            <svg class="icon"><use href="#i-trash"/></svg>
          </button>
        </div>
        <div class="env-files">
          ${[...bucket.plainFiles, ...bucket.secureFiles]
            .map((f) => `<span class="file-chip ${f.secure ? "secure" : ""}">${escapeHtml(f.name)}</span>`)
            .join("")}
        </div>
        ${hasSecure
          ? `<div class="env-config">
               <div class="field">
                 <label>Secret key <span class="muted">(optional)</span></label>
                 <div class="input-group">
                   <span class="input-leading"><svg class="icon"><use href="#i-key"/></svg></span>
                   <input type="${bucket.config.show ? "text" : "password"}" class="env-key" data-env="${escapeAttr(envName)}" value="${escapeAttr(bucket.config.key)}" placeholder="Leave empty to keep values encrypted" spellcheck="false" />
                   <button type="button" class="input-trailing env-key-toggle" data-env="${escapeAttr(envName)}" aria-label="Show or hide key">
                     <svg class="icon"><use href="${bucket.config.show ? "#i-eye-slash" : "#i-eye"}"/></svg>
                   </button>
                 </div>
               </div>
               <div class="field">
                 <label>Algorithm</label>
                 <select class="env-algo" data-env="${escapeAttr(envName)}">
                   ${["AES", "Blowfish", "DES", "DESede"].map((a) => `<option value="${a}" ${bucket.config.algo === a ? "selected" : ""}>${a}</option>`).join("")}
                 </select>
               </div>
               <div class="field">
                 <label>Mode</label>
                 <select class="env-mode" data-env="${escapeAttr(envName)}">
                   ${["CBC", "CFB", "ECB", "OFB"].map((m) => `<option value="${m}" ${bucket.config.mode === m ? "selected" : ""}>${m}</option>`).join("")}
                 </select>
               </div>
               <label class="checkbox">
                 <input type="checkbox" class="env-iv" data-env="${escapeAttr(envName)}" ${bucket.config.randomIv ? "checked" : ""} ${bucket.config.mode === "ECB" ? "disabled" : ""} />
                 <span>Random IV</span>
               </label>
             </div>`
          : ""}
      `;
      host.appendChild(item);
    }

    if (unmatched.length) {
      const warn = document.createElement("div");
      warn.className = "env-item";
      warn.innerHTML = `
        <div class="env-item-header">
          <div class="env-name"><span class="muted">Unmatched</span></div>
        </div>
        <div class="env-files">
          ${unmatched.map((f) => `<span class="file-chip">${escapeHtml(f.name)}</span>`).join("")}
        </div>
        <small class="hint">These files don't match the env or secure pattern and will be ignored.</small>
      `;
      host.appendChild(warn);
    }

    // Wire up controls
    host.querySelectorAll(".env-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.env;
        inspector.files = inspector.files.filter((f) => f.env !== name);
        reclassifyFiles();
      });
    });
    host.querySelectorAll(".env-key").forEach((inp) => {
      inp.addEventListener("input", () => {
        const b = inspector.envs.get(inp.dataset.env);
        if (b) b.config.key = inp.value;
      });
    });
    host.querySelectorAll(".env-key-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const b = inspector.envs.get(btn.dataset.env);
        if (!b) return;
        b.config.show = !b.config.show;
        renderEnvList();
      });
    });
    host.querySelectorAll(".env-algo").forEach((sel) => {
      sel.addEventListener("change", () => {
        const b = inspector.envs.get(sel.dataset.env);
        if (b) b.config.algo = sel.value;
      });
    });
    host.querySelectorAll(".env-mode").forEach((sel) => {
      sel.addEventListener("change", () => {
        const b = inspector.envs.get(sel.dataset.env);
        if (b) {
          b.config.mode = sel.value;
          if (sel.value === "ECB") b.config.randomIv = false;
          renderEnvList();
        }
      });
    });
    host.querySelectorAll(".env-iv").forEach((cb) => {
      cb.addEventListener("change", () => {
        const b = inspector.envs.get(cb.dataset.env);
        if (b) b.config.randomIv = cb.checked;
      });
    });

    wireEnvDragAndDrop(host);
  }

  // Drag-and-drop reordering for "custom" sort mode. Uses HTML5 DnD with
  // a single `dragover` handler that moves the dragged card to the
  // drop-target position in real time.
  function wireEnvDragAndDrop(host) {
    let dragged = null;

    host.querySelectorAll(".env-item").forEach((item) => {
      item.addEventListener("dragstart", (e) => {
        dragged = item;
        item.classList.add("dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          // Firefox requires data to be set for dragstart to fire properly
          e.dataTransfer.setData("text/plain", item.dataset.env || "");
        }
      });
      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
        dragged = null;
        // Persist the new order
        inspector.envOrder = Array.from(host.querySelectorAll(".env-item"))
          .map((el) => el.dataset.env)
          .filter(Boolean);
        if (inspector.results) {
          reorderResults();
          renderTable();
        }
      });
    });

    host.addEventListener("dragover", (e) => {
      if (!dragged) return;
      e.preventDefault();
      const afterEl = getDragAfterElement(host, e.clientY);
      if (afterEl == null) host.appendChild(dragged);
      else host.insertBefore(dragged, afterEl);
    });
  }

  function getDragAfterElement(host, y) {
    const items = [...host.querySelectorAll(".env-item:not(.dragging)")];
    let closest = null;
    let closestOffset = Number.NEGATIVE_INFINITY;
    for (const el of items) {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closestOffset) {
        closestOffset = offset;
        closest = el;
      }
    }
    return closest;
  }

  function analyzeEnvs() {
    setInspectStatus("");
    if (!inspector.envs.size) return;

    // Keys are optional — only validate ones that were provided.
    for (const [env, bucket] of inspector.envs) {
      if (!bucket.secureFiles.length) continue;
      if (!bucket.config.key) continue; // leave values encrypted
      const err = validateKey(bucket.config.algo, bucket.config.key);
      if (err) return setInspectStatus(`${env}: ${err}`, "error");
    }

    // Build per-env key -> value maps, flagging secure and decryption issues
    const envNames = orderedEnvNames();
    const perEnv = new Map();
    for (const env of envNames) {
      const bucket = inspector.envs.get(env);
      const merged = new Map(); // key -> { value, secure, encrypted, error, sourceFile }
      const hasKey = !!bucket.config.key;

      for (const file of [...bucket.plainFiles, ...bucket.secureFiles]) {
        const pairs = parseProperties(file.content, file.format);
        for (const pair of pairs) {
          const { key, value, isList, items } = pair;
          let v = value;
          let secure = false;
          let encrypted = false;
          let error = null;

          if (isList && items) {
            // Process each list item so encrypted elements get decrypted
            const out = [];
            for (const item of items) {
              const inner = unwrapSecure(item);
              if (!inner.wrapped) { out.push(item); continue; }
              secure = true;
              if (!hasKey) {
                out.push(inner.value);
                encrypted = true;
              } else {
                try {
                  const dec = decrypt(bucket.config.algo, bucket.config.mode, bucket.config.key, inner.value, { randomIv: bucket.config.randomIv });
                  if (dec == null || dec === "") {
                    error = "Decryption produced empty result.";
                    out.push(inner.value);
                    encrypted = true;
                  } else {
                    out.push(dec);
                  }
                } catch (e) {
                  error = e.message || "Decryption failed.";
                  out.push(inner.value);
                  encrypted = true;
                }
              }
            }
            v = `[${out.join(", ")}]`;
            if (file.secure && !secure) secure = true;
          } else {
            const inner = unwrapSecure(v);
            if (inner.wrapped) {
              secure = true;
              if (!hasKey) {
                v = inner.value;
                encrypted = true;
              } else {
                try {
                  v = decrypt(bucket.config.algo, bucket.config.mode, bucket.config.key, inner.value, { randomIv: bucket.config.randomIv });
                  if (v == null || v === "") {
                    error = "Decryption produced empty result.";
                    v = inner.value;
                    encrypted = true;
                  }
                } catch (e) {
                  error = e.message || "Decryption failed.";
                  v = inner.value;
                  encrypted = true;
                }
              }
            } else if (file.secure) {
              secure = true;
            }
          }

          // Later file wins if same key appears twice
          merged.set(key, { value: v, secure, encrypted, error, sourceFile: file.name });
        }
      }
      perEnv.set(env, merged);
    }

    // Collect union of all keys (sorted)
    const keySet = new Set();
    for (const m of perEnv.values()) for (const k of m.keys()) keySet.add(k);
    const keys = Array.from(keySet).sort();

    // Build rows with status. Encrypted (undecrypted) values are excluded
    // from diff detection — comparing ciphertexts would be noise.
    const rows = keys.map((key) => {
      const cells = envNames.map((env) => {
        const m = perEnv.get(env).get(key);
        if (!m) return { missing: true };
        return { ...m };
      });
      const present = cells.filter((c) => !c.missing);
      const missing = cells.some((c) => c.missing);
      const comparable = present.filter((c) => !c.encrypted && !c.error);
      const values = comparable.map((c) => c.value);
      const allEqual = values.every((v) => v === values[0]);
      return {
        key,
        cells,
        missing,
        different: comparable.length > 1 && !allEqual,
        anySecure: cells.some((c) => !c.missing && c.secure),
        anyEncrypted: cells.some((c) => !c.missing && c.encrypted),
      };
    });

    inspector.results = { envs: envNames, keys, rows };
    inspector.revealed.clear();

    $("inspectResults").hidden = false;
    renderTable();
    document.body.classList.add("inspect-wide");

    const errs = rows.reduce((n, r) => n + r.cells.filter((c) => c.error).length, 0);
    const enc = rows.reduce((n, r) => n + r.cells.filter((c) => c.encrypted && !c.error).length, 0);
    const bits = [`Analyzed ${keys.length} key(s) across ${envNames.length} env(s).`];
    if (enc) bits.push(`${enc} value(s) left encrypted (no key provided).`);
    if (errs) bits.push(`${errs} decryption error(s).`);
    setInspectStatus(bits.join(" "), errs ? "error" : enc ? "info" : "ok");
  }

  // Parse a .properties or YAML file into flat key/value pairs.
  // YAML support covers nested maps, inline comments, quoted strings, and
  // block sequences:
  //   - scalar sequences become `key = [v1, v2, v3]`
  //   - sequences of mappings become `key[0].field`, `key[1].field`, …
  //   - encrypted items inside a list keep their `![…]` wrapper so they are
  //     decrypted downstream.
  // Not supported: anchors/aliases, multi-line strings, merge keys.
  function parseProperties(content, format) {
    const pairs = [];
    const lines = content.split(/\r?\n/);
    if (format !== "yaml") {
      for (const line of lines) {
        if (!line.trim() || /^\s*[#!]/.test(line)) continue;
        const m = line.match(/^\s*([^=:\s][^=:]*?)\s*[=:]\s*(.*)$/);
        if (!m) continue;
        pairs.push({ key: m[1].trim(), value: m[2] });
      }
      return pairs;
    }

    // --- YAML tokenizer ---
    // Each token: { indent, kind: "map"|"seq", key?, value, lineNo }
    const tokens = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw.trim() || /^\s*#/.test(raw)) continue;
      const indent = raw.match(/^(\s*)/)[1].length;
      let body = raw.slice(indent);

      // Strip trailing inline comment
      const h = findUnquotedHash(body);
      if (h >= 0) body = body.slice(0, h).replace(/\s+$/, "");

      if (body === "-" || body.startsWith("- ")) {
        const rest = body === "-" ? "" : body.slice(2);
        tokens.push({ indent, kind: "seq", value: rest, lineNo: i + 1 });
      } else {
        const m = body.match(/^([^:#\s][^:]*?)\s*:\s*(.*)$/);
        if (!m) continue;
        tokens.push({ indent, kind: "map", key: m[1], value: m[2], lineNo: i + 1 });
      }
    }

    // Helper: unquote a scalar value.
    const unquote = (v) => {
      if (v.length >= 2) {
        const f = v[0], l = v[v.length - 1];
        if ((f === '"' && l === '"') || (f === "'" && l === "'")) return v.slice(1, -1);
      }
      return v;
    };

    // --- Recursive descent ---
    // Emits pairs and returns the next index to process.
    let idx = 0;

    function parseBlock(minIndent, pathPrefix) {
      while (idx < tokens.length && tokens[idx].indent >= minIndent) {
        const tok = tokens[idx];
        if (tok.indent > minIndent) {
          // stray over-indentation — skip
          idx++;
          continue;
        }
        if (tok.kind === "seq") {
          // Top-level sequence encountered here is unexpected in this path;
          // leave it for the caller to pick up via parseSequence.
          return;
        }
        // kind === "map"
        const keyPath = pathPrefix.concat(tok.key);
        const keyStr = keyPath.join(".");

        if (tok.value !== "") {
          pairs.push({ key: keyStr, value: unquote(tok.value) });
          idx++;
          continue;
        }

        // Empty value → look ahead for a nested block
        idx++;
        if (idx < tokens.length && tokens[idx].indent > tok.indent) {
          const childIndent = tokens[idx].indent;
          if (tokens[idx].kind === "seq") {
            parseSequence(keyStr, keyPath, childIndent);
          } else {
            parseBlock(childIndent, keyPath);
          }
        } else {
          // No children — emit as empty scalar
          pairs.push({ key: keyStr, value: "" });
        }
      }
    }

    // Parse a block sequence under `pathPrefix`. Emits a single joined row
    // for scalar lists, or indexed rows for list-of-mappings.
    function parseSequence(keyStr, pathPrefix, seqIndent) {
      const scalarItems = [];
      let itemIdx = 0;
      let anyMapping = false;

      while (idx < tokens.length && tokens[idx].indent === seqIndent && tokens[idx].kind === "seq") {
        const tok = tokens[idx];
        idx++;

        // Does the "- value" look like an inline key: value (mapping element)?
        const mapInline = tok.value.match(/^([^:#\s][^:]*?)\s*:\s*(.*)$/);
        const hasChildren = idx < tokens.length && tokens[idx].indent > seqIndent;

        if (mapInline || hasChildren) {
          anyMapping = true;
          const elemPath = pathPrefix.slice(0, -1).concat(`${pathPrefix[pathPrefix.length - 1]}[${itemIdx}]`);
          if (mapInline) {
            const [, k, v] = mapInline;
            const subPath = elemPath.concat(k);
            if (v !== "") {
              pairs.push({ key: subPath.join("."), value: unquote(v) });
            } else if (hasChildren) {
              parseBlock(tokens[idx].indent, subPath);
            } else {
              pairs.push({ key: subPath.join("."), value: "" });
            }
          }
          // Also consume any deeper block that belongs to this list item
          if (idx < tokens.length && tokens[idx].indent > seqIndent) {
            parseBlock(tokens[idx].indent, elemPath);
          }
          itemIdx++;
        } else {
          // Plain scalar
          scalarItems.push(unquote(tok.value));
          itemIdx++;
        }
      }

      if (!anyMapping) {
        // Emit the whole list as one row so it can be diffed across envs
        pairs.push({ key: keyStr, value: `[${scalarItems.join(", ")}]`, isList: true, items: scalarItems });
      }
    }

    parseBlock(0, []);
    return pairs;
  }

  function renderTable() {
    const table = $("inspectTable");
    const summary = $("inspectSummary");
    if (!inspector.results) { table.innerHTML = ""; summary.innerHTML = ""; return; }
    const { envs, rows } = inspector.results;

    const filter = $("inspectFilter").value.trim().toLowerCase();
    const missingOnly = $("missingOnly").checked;
    const diffOnly = $("diffOnly").checked;
    const revealAll = $("revealAll").checked;

    const filtered = rows.filter((r) => {
      if (filter && !r.key.toLowerCase().includes(filter)) return false;
      if (missingOnly && !r.missing) return false;
      if (diffOnly && !r.different) return false;
      return true;
    });

    // Header
    const keyColPct = envs.length <= 3 ? 26 : envs.length <= 6 ? 20 : 16;
    const envColPct = (100 - keyColPct) / Math.max(envs.length, 1);
    let html = "<colgroup>";
    html += `<col style="width:${keyColPct}%" />`;
    for (let i = 0; i < envs.length; i++) html += `<col style="width:${envColPct}%" />`;
    html += "</colgroup>";
    html += "<thead><tr>";
    html += `<th class="key-col">Property (${rows.length})</th>`;
    for (const e of envs) html += `<th>${escapeHtml(e)}</th>`;
    html += "</tr></thead><tbody>";

    for (const r of filtered) {
      html += "<tr>";
      const keyClasses = [];
      if (r.missing) keyClasses.push("missing-key");
      if (r.different) keyClasses.push("diff-key");
      html += `<td class="key-col" data-key="${escapeAttr(r.key)}" title="${escapeAttr(r.key)}">${escapeHtml(r.key)}</td>`;
      for (let i = 0; i < envs.length; i++) {
        const c = r.cells[i];
        const env = envs[i];
        if (c.missing) {
          html += `<td class="missing" data-key="${escapeAttr(r.key)}" data-env="${escapeAttr(env)}">—</td>`;
          continue;
        }
        const cls = [];
        if (c.error) cls.push("error");
        else if (c.encrypted) cls.push("encrypted");
        if (r.different && !c.missing && !c.encrypted && !c.error) cls.push("diff");
        const revealKey = `${r.key}|${env}`;
        const revealed = revealAll || inspector.revealed.has(revealKey);
        let display;
        let title;
        if (c.error) {
          display = `⚠ ${escapeHtml(c.error)}`;
          title = c.error;
        } else if (c.encrypted) {
          // Show ciphertext with a small lock glyph; no masking (it's already encrypted).
          display = `<span class="val-enc" title="Encrypted — no key provided">🔒 ${escapeHtml(c.value)}</span>`;
          title = `Encrypted (no key provided) — ${c.value}`;
        } else if (c.secure) {
          display = `<span class="val-secret ${revealed ? "revealed" : ""}" data-reveal="${escapeAttr(revealKey)}" title="${revealed ? "Click to hide" : "Click to reveal"}">${escapeHtml(revealed ? c.value : "")}</span>`;
          title = "Decrypted secret (click to toggle)";
        } else {
          display = escapeHtml(c.value);
          title = c.value;
        }
        html += `<td class="${cls.join(" ")}" data-key="${escapeAttr(r.key)}" data-env="${escapeAttr(env)}" title="${escapeAttr(title)}">${display}</td>`;
      }
      html += "</tr>";
    }
    html += "</tbody>";
    table.innerHTML = html;

    // Attach click handlers for per-cell reveal
    table.querySelectorAll(".val-secret").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const k = el.dataset.reveal;
        if (inspector.revealed.has(k)) inspector.revealed.delete(k);
        else inspector.revealed.add(k);
        renderTable();
      });
    });

    // Click anywhere on a cell opens the value dialog. The reveal span
    // stops propagation so masking toggles don't also open the dialog.
    table.querySelectorAll("td").forEach((td) => {
      td.addEventListener("click", () => openValueDialog(td));
    });

    // Summary
    const missingCount = rows.filter((r) => r.missing).length;
    const diffCount = rows.filter((r) => r.different).length;
    const encCount = rows.filter((r) => r.anyEncrypted).length;
    const okCount = rows.filter((r) => !r.missing && !r.different && !r.anyEncrypted).length;
    summary.innerHTML = `
      <span class="pill">${envs.length} env(s)</span>
      <span class="pill">${rows.length} key(s)</span>
      <span class="pill ok">${okCount} identical</span>
      <span class="pill diff">${diffCount} differing</span>
      <span class="pill missing">${missingCount} missing</span>
      ${encCount ? `<span class="pill encrypted">${encCount} encrypted</span>` : ""}
      <span class="muted">Showing ${filtered.length} row(s).</span>
    `;
  }

  function clearInspector() {
    inspector.files = [];
    inspector.envs = new Map();
    inspector.envOrder = [];
    inspector.results = null;
    inspector.revealed.clear();
    $("inspectFileInput").value = "";
    $("inspectFolderInput").value = "";
    $("envListPanel").hidden = true;
    $("envList").hidden = true;
    $("envList").innerHTML = "";
    $("inspectResults").hidden = true;
    $("inspectTable").innerHTML = "";
    $("inspectSummary").innerHTML = "";
    $("analyzeBtn").disabled = true;
    setFullscreen(false);
    document.body.classList.remove("inspect-wide");
    setInspectStatus("");
  }

  function openValueDialog(td) {
    if (!inspector.results) return;
    const key = td.dataset.key;
    const env = td.dataset.env; // may be undefined on the key column
    if (!key) return;

    const row = inspector.results.rows.find((r) => r.key === key);
    if (!row) return;

    const dialog = $("valueDialog");
    const title = $("valueDialogTitle");
    const eyebrow = $("valueDialogEyebrow");
    const meta = $("valueDialogMeta");
    const detail = $("valueDialogDetail");
    const copyBtn = $("valueDialogCopy");
    $("valueDialogStatus").textContent = "";
    $("valueDialogStatus").className = "status";

    if (!env || td.classList.contains("key-col")) {
      // Clicked the key column — show the full property path
      eyebrow.textContent = "Property key";
      title.textContent = key;
      meta.innerHTML = `
        <span class="pill">${inspector.results.envs.length} env(s)</span>
        ${row.missing ? '<span class="pill missing">missing in some env</span>' : ""}
        ${row.different ? '<span class="pill encrypted">differs across envs</span>' : ""}
        ${row.anySecure ? '<span class="pill secure">secure</span>' : ""}
      `;
      detail.innerHTML = `
        <div class="cell-detail-row">
          <span class="cell-detail-label">Key</span>
          <code class="cell-detail-value cell-detail-value-main">${escapeHtml(key)}</code>
        </div>
        <div class="cell-detail-row">
          <span class="cell-detail-label">Environments</span>
          <code class="cell-detail-value">${escapeHtml(inspector.results.envs.join(", "))}</code>
        </div>
      `;
      dialog.dataset.copy = key;
      copyBtn.disabled = false;
    } else {
      const cell = row.cells[inspector.results.envs.indexOf(env)];
      eyebrow.textContent = "Cell value";
      title.textContent = key;
      const pills = [];
      if (cell && cell.missing) pills.push('<span class="pill missing">missing</span>');
      if (cell && cell.secure && !cell.encrypted) pills.push('<span class="pill secure">decrypted secret</span>');
      if (cell && cell.encrypted) pills.push('<span class="pill encrypted">encrypted \u2014 no key</span>');
      if (cell && cell.error) pills.push('<span class="pill error">decryption error</span>');
      if (cell && cell.sourceFile) pills.push(`<span class="pill">${escapeHtml(cell.sourceFile)}</span>`);
      meta.innerHTML = pills.join("");

      var displayValue = "";
      var isMissing = !cell || cell.missing;

      if (isMissing) {
        displayValue = "(not defined in this environment)";
        dialog.dataset.copy = "";
        copyBtn.disabled = true;
      } else if (cell.error) {
        displayValue = cell.error + "\n\nCiphertext: " + cell.value;
        dialog.dataset.copy = cell.value;
        copyBtn.disabled = false;
      } else {
        displayValue = cell.value != null ? String(cell.value) : "";
        dialog.dataset.copy = displayValue;
        copyBtn.disabled = false;
      }

      detail.innerHTML = `
        <div class="cell-detail-row">
          <span class="cell-detail-label">Key</span>
          <code class="cell-detail-value">${escapeHtml(key)}</code>
        </div>
        <div class="cell-detail-row">
          <span class="cell-detail-label">Environment</span>
          <code class="cell-detail-value">${escapeHtml(env)}</code>
        </div>
        <div class="cell-detail-row">
          <span class="cell-detail-label">Value</span>
          <code class="cell-detail-value${isMissing ? "" : " cell-detail-value-main"}">${escapeHtml(displayValue)}</code>
        </div>
      `;
    }

    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  async function copyDialogValue() {
    const text = $("valueDialog").dataset.copy || "";
    if (!text) return;
    const btn = $("valueDialogCopy");
    const label = btn.querySelector("span");
    try {
      await navigator.clipboard.writeText(text);
      label.textContent = "Copied!";
      setTimeout(function () { label.textContent = "Copy"; }, 2000);
    } catch {
      label.textContent = "Failed";
      setTimeout(function () { label.textContent = "Copy"; }, 2000);
    }
  }

  function setInspectStatus(msg, kind) {
    writeStatus($("inspectStatus"), msg, kind);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(s) { return escapeHtml(s); }

  // ==========================================================================
  // Syntax Highlighter (YAML / .properties)
  // ==========================================================================

  function hlEsc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function tokeniseValue(raw) {
    if (!raw) return "";

    // Quoted string — may contain ![...] inside
    var quoteMatch = raw.match(/^(['"])(.*)\1$/);
    if (quoteMatch) {
      var q = quoteMatch[1], inner = quoteMatch[2];
      return (
        '<span class="hl-string-quote">' + hlEsc(q) + "</span>" +
        tokeniseValue(inner) +
        '<span class="hl-string-quote">' + hlEsc(q) + "</span>"
      );
    }

    // Encrypted value ![...]
    var encMatch = raw.match(/^(!\[)(.*?)(\])(.*)$/);
    if (encMatch) {
      var open = encMatch[1], cipher = encMatch[2], close = encMatch[3], rest = encMatch[4];
      return (
        '<span class="hl-bracket">' + hlEsc(open) + "</span>" +
        '<span class="hl-encrypted">' + hlEsc(cipher) + "</span>" +
        '<span class="hl-bracket">' + hlEsc(close) + "</span>" +
        (rest ? '<span class="hl-value">' + hlEsc(rest) + "</span>" : "")
      );
    }

    // Boolean / null
    if (/^(true|false|yes|no|null|~)$/i.test(raw.trim())) {
      return '<span class="hl-boolean">' + hlEsc(raw) + "</span>";
    }

    // Number
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw.trim())) {
      return '<span class="hl-number">' + hlEsc(raw) + "</span>";
    }

    return '<span class="hl-value">' + hlEsc(raw) + "</span>";
  }

  function highlightYamlLine(line) {
    if (!line.trim()) return "";

    // Comment
    if (/^\s*#/.test(line)) {
      return '<span class="hl-comment">' + hlEsc(line) + "</span>";
    }

    // Sequence item: "  - value"
    var seqMatch = line.match(/^(\s*)(- ?)(.*)$/);
    if (seqMatch && !seqMatch[3].includes(":")) {
      return (
        hlEsc(seqMatch[1]) +
        '<span class="hl-punctuation">' + hlEsc(seqMatch[2]) + "</span>" +
        tokeniseValue(seqMatch[3].trim())
      );
    }

    // Key: value
    var kvMatch = line.match(/^(\s*)([^:#\s][^:]*?)\s*:\s*(.*)$/);
    if (kvMatch) {
      var indent = kvMatch[1], key = kvMatch[2], value = kvMatch[3];

      // Strip trailing inline comment
      var val = value;
      var trailingComment = "";
      var hashIdx = val.search(/\s#/);
      if (hashIdx >= 0 && !val.startsWith('"') && !val.startsWith("'")) {
        trailingComment = val.slice(hashIdx);
        val = val.slice(0, hashIdx);
      }

      return (
        hlEsc(indent) +
        '<span class="hl-key">' + hlEsc(key) + "</span>" +
        '<span class="hl-separator">: </span>' +
        tokeniseValue(val.trim()) +
        (trailingComment ? '<span class="hl-comment">' + hlEsc(trailingComment) + "</span>" : "")
      );
    }

    return hlEsc(line);
  }

  function highlightPropertiesLine(line) {
    if (!line.trim()) return "";

    // Comment (# or !)
    if (/^\s*[#!]/.test(line)) {
      return '<span class="hl-comment">' + hlEsc(line) + "</span>";
    }

    // key=value or key: value
    var kvMatch = line.match(/^(\s*)([^=:\s][^=:]*?)\s*([=:])\s*(.*)$/);
    if (kvMatch) {
      return (
        hlEsc(kvMatch[1]) +
        '<span class="hl-key">' + hlEsc(kvMatch[2]) + "</span>" +
        '<span class="hl-separator">' + hlEsc(kvMatch[3]) + "</span>" +
        tokeniseValue(kvMatch[4])
      );
    }

    return hlEsc(line);
  }

  function highlightContent(content, lang) {
    var lines = content.split("\n");
    var fn = lang === "yaml" ? highlightYamlLine : highlightPropertiesLine;
    return lines.map(fn).join("\n");
  }

  // ==========================================================================
  // File Preview Dialog
  // ==========================================================================

  $("fpClose").addEventListener("click", closeFilePreview);
  $("fpDismiss").addEventListener("click", closeFilePreview);
  $("fpCopy").addEventListener("click", copyFilePreview);
  $("filePreviewDialog").addEventListener("click", function (e) {
    if (e.target === $("filePreviewDialog")) closeFilePreview();
  });

  function openFilePreview() {
    var content = $("fileOutput").value;
    if (!content || !state.file) return;

    var fileName = state.file.name;
    var ext = (fileName.match(/\.([^.]+)$/) || ["", ""])[1].toLowerCase();
    var lang = (ext === "yaml" || ext === "yml") ? "yaml" : "properties";
    var lineCount = content.split("\n").length;

    $("fpEyebrow").textContent = "Output preview \u00B7 " + lang.toUpperCase();
    $("fpTitle").textContent = fileName;
    $("fpMeta").innerHTML =
      '<span class="pill">' + lineCount + " line" + (lineCount !== 1 ? "s" : "") + "</span>" +
      '<span class="pill">' + formatBytes(new TextEncoder().encode(content).length) + "</span>";
    $("fpBody").innerHTML = highlightContent(content, lang);

    $("filePreviewDialog").dataset.copy = content;
    $("filePreviewDialog").showModal();
  }

  function closeFilePreview() {
    $("filePreviewDialog").close();
  }

  function copyFilePreview() {
    var text = $("filePreviewDialog").dataset.copy || "";
    if (!text) return;
    var status = $("fpStatus");
    navigator.clipboard.writeText(text).then(function () {
      status.className = "status visible ok";
      status.innerHTML = '<svg class="icon"><use href="#i-check"/></svg><span>Copied to clipboard.</span>';
      setTimeout(function () { status.textContent = ""; status.className = "status"; }, 2500);
    }).catch(function () {
      status.className = "status visible error";
      status.innerHTML = '<svg class="icon"><use href="#i-exclamation-triangle"/></svg><span>Could not copy.</span>';
      setTimeout(function () { status.textContent = ""; status.className = "status"; }, 2500);
    });
  }
})();
