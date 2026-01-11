// --- CẤU HÌNH ---
const mqttConfig = [
    { host: "dontseeme.duckdns.org", port: 9443, path: "/mqtt", name: "Main", username: "noobies", password: "" },
    { host: "test.mosquitto.org", port: 8081, path: "/", name: "Backup", username: "admin", password: "" }
];

const TOPICS = {
    TEMP: "farm/coop1/sensor/temp",
    VFD_CMD: "farm/coop1/control/vfd",
    VFD_CFG: "farm/coop1/config/vfd_params",
    FAN2: "farm/coop1/control/fan2",
    FAN3: "farm/coop1/control/fan3",
    FAN4: "farm/coop1/control/fan4",
    FAN5: "farm/coop1/control/fan5"
};

let client = null, serverIdx = 0, isConnected = false, currentTemp = 0.0, userPass = "";
let settings = { target: 28.0, d2: 1.0, d3: 2.0, d4: 3.0, d5: 4.0, mode: 'auto' };
let reconnectTimer = null;
let isDragging = false; 

function vibrate(ms=10) { if(navigator.vibrate) navigator.vibrate(ms); }

window.onload = () => {
    const saved = localStorage.getItem('appPass');
    if(saved) { userPass = saved; document.getElementById('app-password').value = saved; checkLogin(); }
    document.addEventListener('dblclick', function(event) { event.preventDefault(); }, { passive: false });
    window.onclick = function(event) {
        const settingsModal = document.getElementById('settings-modal');
        const vfdModal = document.getElementById('vfd-modal');
        if (event.target === settingsModal) closeSettings();
        if (event.target === vfdModal) closeVFDModal();
    }
    setupSliderEvents();
    updateModeUI();
};

function setupSliderEvents() {
    const slider = document.getElementById('manual-vfd');
    slider.addEventListener('mousedown', () => { isDragging = true; });
    slider.addEventListener('touchstart', () => { isDragging = true; }, {passive: true});
    slider.addEventListener('input', function() { updateVFDVisuals(this.value); });
    const endDrag = function() {
        isDragging = false;
        if(settings.mode === 'manual') { pub(TOPICS.VFD_CMD, slider.value); vibrate(15); }
    };
    slider.addEventListener('change', endDrag);
    slider.addEventListener('mouseup', () => { isDragging = false; });
    slider.addEventListener('touchend', () => { isDragging = false; });
}

// HÀM BẬT TẮT HIỂN THỊ MẬT KHẨU
function togglePwd() {
    const inp = document.getElementById('app-password');
    const icon = document.getElementById('toggle-pwd');
    if(inp.type === "password"){
        inp.type = "text";
        icon.innerText = "🙈"; // Icon mắt đóng
    } else {
        inp.type = "password";
        icon.innerText = "👁️"; // Icon mắt mở
    }
}

function checkLogin() {
    const val = document.getElementById('app-password').value;
    // Cho phép nhập trống nếu cấu hình server không có pass
    // if(!val) return document.getElementById('app-password').focus(); 
    
    userPass = val; vibrate(20);
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('login-loading').style.display = 'block';
    document.getElementById('btn-login').disabled = true;
    connectMQTT();
}

function logoutApp() { vibrate(30); localStorage.removeItem('appPass'); location.reload(); }

function connectMQTT() {
    const cfg = mqttConfig[serverIdx];
    const id = "hmi_" + Math.random().toString(16).substr(2, 6);
    if (!reconnectTimer) updateStatus("connecting");
    client = new Paho.MQTT.Client(cfg.host, cfg.port, cfg.path, id);
    client.onConnectionLost = onConnectionLost;
    client.onMessageArrived = onMsg;
    const opts = { timeout: 5, useSSL: true, cleanSession: true, userName: cfg.username, password: userPass, onSuccess: onConnect, onFailure: onFailure };
    try { client.connect(opts); } catch(e) { onFailure(); }
}

function onConnect() {
    console.log("Connected");
    isConnected = true; updateStatus("connected"); setAppOnline(true);
    document.getElementById('login-overlay').style.display = 'none';
    if(document.getElementById('chk-remember').checked) localStorage.setItem('appPass', userPass);
    Object.values(TOPICS).forEach(t => client.subscribe(t));
    if(reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

function onFailure() {
    isConnected = false;
    if(document.getElementById('login-overlay').style.display !== 'none') {
        document.getElementById('login-loading').style.display = 'none';
        document.getElementById('login-error').style.display = 'block';
        document.getElementById('btn-login').disabled = false;
    } else handleReconnect();
}

function onConnectionLost(e) { isConnected = false; handleReconnect(); }

function handleReconnect() {
    setAppOnline(false); updateStatus("reconnecting");
    if(reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { serverIdx = (serverIdx + 1) % mqttConfig.length; connectMQTT(); }, 3000);
}

function setAppOnline(isOnline) {
    const app = document.getElementById('main-app');
    const overlay = document.getElementById('reconnect-overlay');
    if (isOnline) { app.classList.remove('offline-mode'); overlay.classList.remove('active'); }
    else { app.classList.add('offline-mode'); overlay.classList.add('active'); }
}

function updateStatus(state) {
    const el = document.getElementById('connection-status');
    const txt = el.querySelector('.status-text');
    el.className = 'connection-pill';
    if (state === "connected") { el.classList.add('connected'); txt.innerText = 'ĐÃ KẾT NỐI'; }
    else if (state === "reconnecting" || state === "connecting") { el.classList.add('reconnecting'); txt.innerText = 'ĐANG KẾT NỐI...'; }
    else { el.classList.add('disconnected'); txt.innerText = 'MẤT KẾT NỐI'; }
}

function pub(topic, val) {
    if(client && isConnected) {
        const msg = new Paho.MQTT.Message(val.toString());
        msg.destinationName = topic; msg.retained = true; client.send(msg);
    }
}

function onMsg(msg) {
    const t = msg.destinationName, p = msg.payloadString;
    if(t === TOPICS.TEMP) { currentTemp = parseFloat(p); updateTempUI(); if(settings.mode === 'auto') runAuto(); }
    else if(t === TOPICS.VFD_CMD) { if (!isDragging) { updateVFDVisuals(p); document.getElementById('manual-vfd').value = parseInt(p); } }
    else if(t.includes('fan')) updateRelay(t.slice(-1), p);
}

function updateTempUI() {
    const el = document.getElementById('current-temp');
    el.innerText = currentTemp.toFixed(1);
    el.className = 'lcd-text';
    if (currentTemp > settings.target + 2) el.classList.add('hot');
    else if (currentTemp < settings.target - 2) el.classList.add('cold');
    else el.classList.add('good');
}

function runAuto() {
    const diff = currentTemp - settings.target;
    let spd = diff > 0 ? Math.min(diff * 40, 100) : 0;
    pub(TOPICS.VFD_CMD, Math.round(spd));
    if (!isDragging) { updateVFDVisuals(Math.round(spd)); document.getElementById('manual-vfd').value = Math.round(spd); }
    [2,3,4,5].forEach(i => {
        const d = settings[`d${i}`];
        const st = (diff >= d) ? "ON" : "OFF";
        pub(TOPICS[`FAN${i}`], st);
        updateRelay(i, st);
    });
}

function updateVFDVisuals(val) {
    const v = parseInt(val);
    document.getElementById('vfd-speed').innerText = v;
    document.getElementById('vfd-progress').style.width = v + '%';
    document.querySelector('.slider-industrial').style.setProperty('--thumb-pos', v + '%');
    const icon = document.getElementById('icon-vfd');
    if (v > 0) { icon.classList.add("spinning"); icon.style.animationDuration = (1.1 - v/100) + "s"; }
    else icon.classList.remove("spinning");
}

function updateRelay(n, val) {
    const on = (val === "ON");
    document.getElementById(`chk-fan${n}`).checked = on;
    const icon = document.getElementById(`icon-fan${n}`);
    const card = document.getElementById(`card-fan${n}`);
    if (on) { icon.classList.add("spinning"); card.classList.add("active"); }
    else { icon.classList.remove("spinning"); card.classList.remove("active"); }
}

function toggleFan(n) {
    vibrate(20);
    if(settings.mode !== 'manual') {
        const chk = document.getElementById(`chk-fan${n}`);
        setTimeout(() => { chk.checked = !chk.checked; }, 200); return;
    }
    const chk = document.getElementById(`chk-fan${n}`);
    pub(TOPICS[`FAN${n}`], chk.checked ? "ON" : "OFF");
}

function openSettings() { vibrate(15); document.getElementById('settings-modal').classList.add('active'); }
function closeSettings() { vibrate(15); document.getElementById('settings-modal').classList.remove('active'); saveSettings(); }

function saveSettings() {
    settings.target = parseFloat(document.getElementById('target-temp').value);
    [2,3,4,5].forEach(i => settings[`d${i}`] = parseFloat(document.getElementById(`delta-fan${i}`).value));
    settings.mode = document.getElementById('mode-auto').checked ? 'auto' : 'manual';
    document.getElementById('disp-target').innerText = settings.target.toFixed(1);
    document.getElementById('mode-badge').innerText = settings.mode === 'auto' ? 'TỰ ĐỘNG' : 'THỦ CÔNG';
    updateModeUI();
    if(settings.mode === 'auto') runAuto();
}

function updateModeUI() {
    const isAuto = (settings.mode === 'auto');
    if (isAuto) document.body.classList.add('auto-mode'); else document.body.classList.remove('auto-mode');
    document.getElementById('manual-vfd').disabled = isAuto;
    for(let i=2; i<=5; i++) document.getElementById(`chk-fan${i}`).disabled = isAuto;
}

function openVFDModal() { vibrate(15); document.getElementById('settings-modal').classList.remove('active'); document.getElementById('vfd-modal').classList.add('active'); }
function closeVFDModal() { vibrate(15); document.getElementById('vfd-modal').classList.remove('active'); document.getElementById('settings-modal').classList.add('active'); }

function sendVFDConfig() {
    vibrate(50);
    if(!confirm("XÁC NHẬN NẠP THÔNG SỐ XUỐNG BIẾN TẦN?")) return;
    const payload = JSON.stringify({
        freq: { min: parseFloat(document.getElementById('vfd-min-hz').value), max: parseFloat(document.getElementById('vfd-max-hz').value) },
        ramp: { acc: parseFloat(document.getElementById('vfd-acc').value), dec: parseFloat(document.getElementById('vfd-dec').value) },
        motor: { volt: parseInt(document.getElementById('motor-volt').value), amp: parseFloat(document.getElementById('motor-amp').value), rpm: parseInt(document.getElementById('motor-rpm').value) },
        protect: parseInt(document.getElementById('vfd-protect').value)
    });
    if(client && isConnected) {
        const msg = new Paho.MQTT.Message(payload);
        msg.destinationName = TOPICS.VFD_CFG; msg.qos = 1; client.send(msg);
        alert("ĐÃ GỬI LỆNH CÀI ĐẶT!");
    } else alert("THIẾT BỊ ĐANG MẤT KẾT NỐI");
}