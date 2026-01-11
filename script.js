// --- CẤU HÌNH ---
const mqttConfig = [
    { host: "dontseeme.duckdns.org", port: 9443, path: "/mqtt", name: "Main", username: "noobies", password: "" },
    { host: "test.mosquitto.org", port: 8081, path: "/", name: "Backup", username: "admin", password: "" }
];

const TOPICS = {
    TEMP: "farm/coop1/sensor/temp",
    VFD_CMD: "farm/coop1/control/vfd",
    VFD_CFG: "farm/coop1/config/vfd_params",
    FAN1: "farm/coop1/control/fan1",
    FAN2: "farm/coop1/control/fan2",
    FAN3: "farm/coop1/control/fan3",
    FAN4: "farm/coop1/control/fan4",
    FAN5: "farm/coop1/control/fan5"
};

let client = null, serverIdx = 0, isConnected = false, currentTemp = 0.0, userPass = "";
// Settings mới: Chỉ còn minHz và pBand
let settings = { target: 28.0, minHz: 10, pBand: 3.0, mode: 'auto' };
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
        const guideModal = document.getElementById('guide-modal');
        if (event.target === settingsModal) closeSettings();
        if (event.target === vfdModal) closeVFDModal();
        if (event.target === guideModal) closeGuide();
    }
    setupSliderEvents();
    setupInputEvents();
    updateModeUI();
};

function setupSliderEvents() {
    const slider = document.getElementById('manual-vfd');
    const wrapper = slider.parentElement; 

    const startDrag = () => { isDragging = true; wrapper.classList.add('dragging'); };
    slider.addEventListener('mousedown', startDrag);
    slider.addEventListener('touchstart', startDrag, {passive: true});

    slider.addEventListener('input', function() { updateVFDVisuals(this.value); });

    const endDrag = function() {
        isDragging = false;
        wrapper.classList.remove('dragging');
        if(settings.mode === 'manual') { pub(TOPICS.VFD_CMD, slider.value); vibrate(15); }
    };

    slider.addEventListener('change', endDrag);
    slider.addEventListener('mouseup', () => { isDragging = false; wrapper.classList.remove('dragging'); });
    slider.addEventListener('touchend', () => { isDragging = false; wrapper.classList.remove('dragging'); });
}

function setupInputEvents() {
    const input = document.getElementById('vfd-input');
    input.addEventListener('change', function() {
        let val = parseFloat(this.value);
        if (isNaN(val)) val = 0;
        if (val < 0) val = 0;
        if (val > 50) val = 50; // Max 50Hz
        
        this.value = val;
        updateVFDVisuals(val);
        if(settings.mode === 'manual') { pub(TOPICS.VFD_CMD, val); vibrate(15); }
    });
}

function togglePwd() {
    const inp = document.getElementById('app-password');
    const icon = document.getElementById('toggle-pwd');
    if(inp.type === "password"){ inp.type = "text"; icon.innerText = "🙈"; } 
    else { inp.type = "password"; icon.innerText = "👁️"; }
}

function checkLogin() {
    const val = document.getElementById('app-password').value;
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
    else if(t === TOPICS.VFD_CMD) { 
        if (!isDragging) { 
            updateVFDVisuals(p); 
            document.getElementById('manual-vfd').value = parseFloat(p); 
            document.getElementById('vfd-input').value = parseFloat(p);
        } 
    }
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

// --- THUẬT TOÁN MỚI: CHỈ ĐIỀU KHIỂN TẦN SỐ (0-50Hz) ---
function runAuto() {
    const diff = currentTemp - settings.target;
    let hz = 0;

    if (diff <= 0) {
        // Nếu lạnh quá (thấp hơn 5 độ) -> Tắt biến tần (0Hz)
        if (diff < -5.0) hz = 0; 
        // Nếu lạnh vừa -> Chạy Min Hz
        else hz = settings.minHz; 
    } else {
        // P-Control: Tăng từ MinHz lên 50Hz
        let addedHz = (diff / settings.pBand) * (50 - settings.minHz);
        hz = settings.minHz + addedHz;
        if (hz > 50) hz = 50;
    }

    // Làm tròn 1 số thập phân
    hz = Math.round(hz * 10) / 10;
    
    pub(TOPICS.VFD_CMD, hz);
    
    if (!isDragging) { 
        updateVFDVisuals(hz); 
        document.getElementById('manual-vfd').value = hz; 
        document.getElementById('vfd-input').value = hz;
    }
    
    // LƯU Ý: Không tự động bật tắt quạt nữa. Người dùng tự bật.
}

function updateVFDVisuals(val) {
    const v = parseFloat(val);
    if(document.activeElement.id !== 'vfd-input') { document.getElementById('vfd-input').value = v; }
    
    // Tính % để hiển thị thanh progress (v / 50 * 100)
    const percent = (v / 50) * 100;
    document.getElementById('vfd-progress').style.width = percent + '%';
    document.querySelector('.slider-industrial').style.setProperty('--thumb-pos', percent + '%');
    
    const icon = document.getElementById('icon-vfd');
    if (v > 0) { icon.classList.add("spinning"); icon.style.animationDuration = (1.1 - percent/100) + "s"; }
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
    // Luôn cho phép bật tắt, không chặn bởi chế độ Auto
    const chk = document.getElementById(`chk-fan${n}`);
    pub(TOPICS[`FAN${n}`], chk.checked ? "ON" : "OFF");
}

function openSettings() { vibrate(15); document.getElementById('settings-modal').classList.add('active'); }
function closeSettings() { vibrate(15); document.getElementById('settings-modal').classList.remove('active'); saveSettings(); }
function openGuide() { vibrate(15); document.getElementById('guide-modal').classList.add('active'); }
function closeGuide() { vibrate(15); document.getElementById('guide-modal').classList.remove('active'); }

function saveSettings() {
    settings.target = parseFloat(document.getElementById('target-temp').value);
    settings.minHz = parseFloat(document.getElementById('min-hz').value) || 0;
    settings.pBand = parseFloat(document.getElementById('p-band').value) || 3.0;
    
    settings.mode = document.getElementById('mode-auto').checked ? 'auto' : 'manual';
    document.getElementById('disp-target').innerText = settings.target.toFixed(1);
    document.getElementById('mode-badge').innerText = settings.mode === 'auto' ? 'TỰ ĐỘNG' : 'THỦ CÔNG';
    updateModeUI();
    if(settings.mode === 'auto') runAuto();
}

function updateModeUI() {
    const isAuto = (settings.mode === 'auto');
    if (isAuto) document.body.classList.add('auto-mode'); else document.body.classList.remove('auto-mode');
    
    // Chỉ khóa điều khiển biến tần, KHÔNG khóa các quạt con
    document.getElementById('manual-vfd').disabled = isAuto;
    document.getElementById('vfd-input').disabled = isAuto;
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