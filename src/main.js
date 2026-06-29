/**
 * main.js - 程序入口
 * 负责 UI 事件绑定、状态管理和视图更新
 */

import { SceneManager } from './SceneManager.js';
import {
  getDayOfYear,
  getDaysInMonth,
  getSolarDeclination,
  getSunriseHourAngle,
  getDayLength,
  getNoonAltitude,
  getSolarAzimuth,
  getSolarAltitude,
  getSolarPosition,
  getDateLabel,
  getGeoDescription,
  degToRad,
  radToDeg,
} from './GeoMath.js';
import './style.css';

// ===== 应用状态 =====
const state = {
  month: 3,
  day: 21,
  hour: 12,
  latitude: 40,
  longitude: 116,
  locations: [],
  activeLocationId: null,
  showHelpers: true,
  showLabels: true,
  animRev: false,
  animRot: false,
  currentView: 'space',
  speedSpace: 1,
  speedEarth: 1,
  speedSurface: 1,
  speedHorizon: 1,
  doyFloat: getDayOfYear(3, 21), // 用于保存连续的浮点日期，解决自动播放低速时取整卡顿
};

const LOCATION_COLORS = [
  '#ff3333', '#33ccff', '#33ff99', '#ff9933', '#cc33ff', '#ffff33', '#ff33cc'
];
let locColorIndex = 0;

// ===== 初始化场景 =====
const container = document.getElementById('canvas-container');
const sceneManager = new SceneManager(container);

// ===== DOM 元素引用 =====
const els = {
  // 滑块
  monthSlider: document.getElementById('month-slider'),
  daySlider: document.getElementById('day-slider'),
  hourSlider: document.getElementById('hour-slider'),
  latSlider: document.getElementById('lat-slider'),
  speedSlider: document.getElementById('speed-slider'),
  // 显示值
  monthValue: document.getElementById('month-value'),
  dayValue: document.getElementById('day-value'),
  hourValue: document.getElementById('hour-value'),
  latValue: document.getElementById('lat-value'),
  speedValue: document.getElementById('speed-value'),
  // 开关
  toggleHelpers: document.getElementById('toggle-helpers'),
  toggleLabels: document.getElementById('toggle-labels'),
  toggleAnimRev: document.getElementById('toggle-anim-rev'),
  rowAnimRev: document.getElementById('row-anim-rev'),
  toggleAnimRot: document.getElementById('toggle-anim-rot'),
  // 面板折叠
  toggleLeftBtn: document.getElementById('toggle-left'),
  toggleRightBtn: document.getElementById('toggle-right'),
  controlPanel: document.getElementById('control-panel'),
  infoPanel: document.getElementById('info-panel'),
  // 视角切换按钮
  btnSpaceView: document.getElementById('btn-space-view'),
  btnEarthView: document.getElementById('btn-earth-view'),
  btnSurfaceView: document.getElementById('btn-surface-view'),
  btnHorizonView: document.getElementById('btn-horizon-view'),
  // Controls
  btnResetCamera: document.getElementById('btn-reset-camera'),
  // 信息面板
  infoDate: document.getElementById('info-date'),
  infoSubsolar: document.getElementById('info-subsolar'),
  infoDaylength: document.getElementById('info-daylength'),
  infoCurrentAlt: document.getElementById('info-current-alt'),
  infoNoonAlt: document.getElementById('info-noon-alt'),
  infoSunriseAz: document.getElementById('info-sunrise-az'),
  infoSunsetAz: document.getElementById('info-sunset-az'),
  infoDescription: document.getElementById('info-description'),
  // 地点管理
  locNameInput: document.getElementById('loc-name'),
  locLatInput: document.getElementById('loc-lat'),
  locLngInput: document.getElementById('loc-lng'),
  btnAddLoc: document.getElementById('btn-add-loc'),
  locationList: document.getElementById('location-list'),
};

// ===== 工具函数 =====

/** 将小时数格式化为 HH:MM */
function formatTime(hour) {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/** 将纬度值格式化为带N/S的字符串 */
function formatLatitude(lat) {
  if (lat === 0) return '0° (赤道)';
  const dir = lat > 0 ? 'N' : 'S';
  return `${Math.abs(lat)}°${dir}`;
}

/** 将经度值格式化为带E/W的字符串 */
function formatLongitude(lng) {
  if (lng === 0) return '0° (本初子午线)';
  if (lng === 180 || lng === -180) return '180° (国际日期变更线)';
  const dir = lng > 0 ? 'E' : 'W';
  return `${Math.abs(lng)}°${dir}`;
}

/** 将方位角（弧度）格式化为方位描述 */
function formatAzimuth(azRad) {
  const azDeg = radToDeg(azRad);
  let dirName = '';
  if (azDeg >= 337.5 || azDeg < 22.5) dirName = '正北';
  else if (azDeg >= 22.5 && azDeg < 67.5) dirName = '东北';
  else if (azDeg >= 67.5 && azDeg < 112.5) dirName = '正东';
  else if (azDeg >= 112.5 && azDeg < 157.5) dirName = '东南';
  else if (azDeg >= 157.5 && azDeg < 202.5) dirName = '正南';
  else if (azDeg >= 202.5 && azDeg < 247.5) dirName = '西南';
  else if (azDeg >= 247.5 && azDeg < 292.5) dirName = '正西';
  else dirName = '西北';
  return `${dirName} ${azDeg.toFixed(1)}°`;
}

// ===== 更新信息面板 =====
function updateInfoPanel() {
  const { month, day, latitude } = state;
  const doy = getDayOfYear(month, day);
  const decl = getSolarDeclination(doy);
  const declDeg = radToDeg(decl);
  const latRad = degToRad(latitude);

  // 日期
  const dateLabel = getDateLabel(month, day);
  els.infoDate.textContent = `${month}月${day}日 (${dateLabel})`;

  // 太阳直射点
  if (Math.abs(declDeg) < 0.5) {
    els.infoSubsolar.textContent = `0° (赤道)`;
  } else if (declDeg > 0) {
    els.infoSubsolar.textContent = `${declDeg.toFixed(1)}°N`;
  } else {
    els.infoSubsolar.textContent = `${Math.abs(declDeg).toFixed(1)}°S`;
  }

  // 昼长
  const dayLen = getDayLength(latRad, decl);
  const ha = getSunriseHourAngle(latRad, decl);

  if (Math.abs(ha - Math.PI) < 0.01) {
    els.infoDaylength.textContent = '24小时 (极昼)';
  } else if (Math.abs(ha) < 0.01) {
    els.infoDaylength.textContent = '0小时 (极夜)';
  } else {
    const h = Math.floor(dayLen);
    const m = Math.round((dayLen - h) * 60);
    els.infoDaylength.textContent = `${h}小时${m}分`;
  }

  // 当前太阳高度角
  // 注意 getSolarPosition 第一个参数需要传入度数（latitude），之前错传了弧度（latRad）导致计算结果异常
  const currentSolarPos = getSolarPosition(latitude, doy, state.hour);
  els.infoCurrentAlt.textContent = `${radToDeg(currentSolarPos.altitude).toFixed(1)}°`;

  // 正午太阳高度角
  const noonAlt = radToDeg(getNoonAltitude(latRad, decl));
  els.infoNoonAlt.textContent = `${noonAlt.toFixed(1)}°`;

  // 日出日落方位
  if (Math.abs(ha - Math.PI) < 0.01) {
    // 极昼
    els.infoSunriseAz.textContent = '—（极昼）';
    els.infoSunsetAz.textContent = '—（极昼）';
  } else if (Math.abs(ha) < 0.01) {
    // 极夜
    els.infoSunriseAz.textContent = '—（极夜）';
    els.infoSunsetAz.textContent = '—（极夜）';
  } else {
    // 日出时角为负值（上午），日落时角为正值（下午）
    const sunriseHourAngle = -ha;
    const sunsetHourAngle = ha;
    const sunriseAlt = getSolarAltitude(latRad, decl, sunriseHourAngle);
    const sunsetAlt = getSolarAltitude(latRad, decl, sunsetHourAngle);
    const sunriseAz = getSolarAzimuth(latRad, decl, sunriseHourAngle, sunriseAlt);
    const sunsetAz = getSolarAzimuth(latRad, decl, sunsetHourAngle, sunsetAlt);
    els.infoSunriseAz.textContent = formatAzimuth(sunriseAz);
    els.infoSunsetAz.textContent = formatAzimuth(sunsetAz);
  }

  // 地理知识描述
  els.infoDescription.textContent = getGeoDescription(month, day, latitude);
}

// ===== 更新 3D 场景 =====
function updateScene() {
  // 始终使用 doyFloat，以保证拖拽和自动播放时的平滑（包含小数部分）
  const doy = state.doyFloat;
  sceneManager.updateView({
    dayOfYear: doy,
    timeOfDay: state.hour,
    showHelpers: state.showHelpers,
    showLabels: state.showLabels,
    latitudeDeg: state.latitude,
    longitudeDeg: state.longitude,
    locations: state.locations,
    activeLocationId: state.activeLocationId,
  });
}

/**
 * 统一处理切换观察者的逻辑
 * 保证切换地点（经度改变）时，地球的物理旋转不动，而是自动折算对应的本地时间
 */
function setActiveObserver(lat, lng, locId = null) {
  const oldLng = state.longitude;
  state.latitude = lat;
  state.longitude = lng;
  state.activeLocationId = locId;

  // 如果经度发生了变化，调整本地时间以保持地球物理旋转不动
  if (oldLng !== lng) {
    let newTime = state.hour + (lng - oldLng) / 15;
    // 限制在 0-24 之间
    while (newTime < 0) newTime += 24;
    while (newTime >= 24) newTime -= 24;
    
    state.hour = newTime;
    els.hourSlider.value = state.hour;
    els.hourValue.textContent = formatTime(state.hour);
  }

  // 更新UI
  els.latSlider.value = lat;
  els.latValue.textContent = formatLatitude(lat);
  
  renderLocationList();
  updateAll();
}

/** 渲染地点列表 */
function renderLocationList() {
  els.locationList.innerHTML = '';
  state.locations.forEach(loc => {
    const item = document.createElement('div');
    item.className = `loc-item ${state.activeLocationId === loc.id ? 'active' : ''}`;
    
    const info = document.createElement('div');
    info.className = 'loc-item-info';
    
    const colorIndicator = document.createElement('span');
    colorIndicator.className = 'loc-color-indicator';
    colorIndicator.style.backgroundColor = loc.color;
    
    const name = document.createElement('span');
    name.className = 'loc-name';
    name.appendChild(colorIndicator);
    const nameText = document.createTextNode(loc.name);
    name.appendChild(nameText);
    
    const coords = document.createElement('span');
    coords.className = 'loc-coords';
    coords.textContent = `${formatLatitude(loc.lat)}, ${formatLongitude(loc.lng)}`;
    
    info.appendChild(name);
    info.appendChild(coords);
    item.appendChild(info);
    
    const delBtn = document.createElement('button');
    delBtn.className = 'loc-delete';
    delBtn.textContent = '×';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      state.locations = state.locations.filter(l => l.id !== loc.id);
      if (state.activeLocationId === loc.id) {
        state.activeLocationId = null; // 解除激活状态
      }
      renderLocationList();
      updateAll();
    };
    
    item.appendChild(delBtn);
    
    item.onclick = () => {
      setActiveObserver(loc.lat, loc.lng, loc.id);
    };
    
    els.locationList.appendChild(item);
  });
}

/** 更新所有显示 */
function updateAll() {
  updateScene();
  updateInfoPanel();
}

// ===== UI 事件绑定 =====

// --- 月份滑块 ---
els.monthSlider.addEventListener('input', (e) => {
  state.month = parseInt(e.target.value);
  els.monthValue.textContent = `${state.month}月`;
  // 限制日期不超过当月最大天数
  const maxDay = getDaysInMonth(state.month);
  if (state.day > maxDay) {
    state.day = maxDay;
    els.daySlider.value = maxDay;
    els.dayValue.textContent = `${maxDay}日`;
  }
  els.daySlider.max = maxDay;
  state.doyFloat = getDayOfYear(state.month, state.day);
  updateAll();
});

// --- 日期滑块 ---
els.daySlider.addEventListener('input', (e) => {
  state.day = parseInt(e.target.value);
  els.dayValue.textContent = `${state.day}日`;
  state.doyFloat = getDayOfYear(state.month, state.day);
  updateAll();
});

// --- 时间滑块 ---
els.hourSlider.addEventListener('input', (e) => {
  state.hour = parseFloat(e.target.value);
  els.hourValue.textContent = formatTime(state.hour);
  updateAll();
});

// --- 纬度滑块 ---
els.latSlider.addEventListener('input', (e) => {
  setActiveObserver(parseFloat(e.target.value), state.longitude, null);
});

// --- 添加地点按钮 ---
els.btnAddLoc.addEventListener('click', () => {
  const name = els.locNameInput.value.trim();
  const lat = parseFloat(els.locLatInput.value);
  const lng = parseFloat(els.locLngInput.value);
  
  if (!name) { alert('请输入地点名称'); return; }
  if (isNaN(lat) || lat < -90 || lat > 90) { alert('纬度无效 (-90~90)'); return; }
  if (isNaN(lng) || lng < -180 || lng > 180) { alert('经度无效 (-180~180)'); return; }
  
  const id = 'loc-' + Date.now();
  const color = LOCATION_COLORS[locColorIndex % LOCATION_COLORS.length];
  locColorIndex++;
  state.locations.push({ id, name, lat, lng, color });
  
  // 清空表单
  els.locNameInput.value = '';
  els.locLatInput.value = '';
  els.locLngInput.value = '';
  
  // 自动激活新加地点
  setActiveObserver(lat, lng, id);
});

// --- 播放速度滑块 ---
els.speedSlider.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  if (state.currentView === 'space') state.speedSpace = val;
  else if (state.currentView === 'earth') state.speedEarth = val;
  else if (state.currentView === 'surface') state.speedSurface = val;
  else state.speedHorizon = val;
  els.speedValue.textContent = `${val.toFixed(1)}x`;
});

function updateSpeedSlider() {
  let val = 1;
  if (state.currentView === 'space') val = state.speedSpace;
  else if (state.currentView === 'earth') val = state.speedEarth;
  else if (state.currentView === 'surface') val = state.speedSurface;
  else val = state.speedHorizon;
  els.speedSlider.value = val;
  els.speedValue.textContent = `${val.toFixed(1)}x`;
}

// --- 开关控件 ---
els.toggleHelpers.addEventListener('change', (e) => {
  state.showHelpers = e.target.checked;
  updateScene();
});

els.toggleLabels.addEventListener('change', (e) => {
  state.showLabels = e.target.checked;
  updateScene();
});

els.toggleAnimRev.addEventListener('change', (e) => {
  state.animRev = e.target.checked;
});

els.toggleAnimRot.addEventListener('change', (e) => {
  state.animRot = e.target.checked;
});

// --- 面板折叠切换 ---
els.toggleLeftBtn.addEventListener('click', () => {
  els.controlPanel.classList.toggle('collapsed');
  if (els.controlPanel.classList.contains('collapsed')) {
    els.toggleLeftBtn.textContent = '▶';
  } else {
    els.toggleLeftBtn.textContent = '◀';
  }
});

els.toggleRightBtn.addEventListener('click', () => {
  els.infoPanel.classList.toggle('collapsed');
  if (els.infoPanel.classList.contains('collapsed')) {
    els.toggleRightBtn.textContent = '◀';
  } else {
    els.toggleRightBtn.textContent = '▶';
  }
});

// --- 视角切换 ---
els.btnSpaceView.addEventListener('click', () => {
  if (state.currentView === 'space') return;
  state.currentView = 'space';
  els.btnSpaceView.classList.add('active');
  els.btnEarthView.classList.remove('active');
  els.btnSurfaceView.classList.remove('active');
  els.btnHorizonView.classList.remove('active');
  document.body.classList.remove('horizon-mode');
  sceneManager.switchView('space');
  els.rowAnimRev.style.display = 'flex';
  updateSpeedSlider();
  updateAll();
});

els.btnEarthView.addEventListener('click', () => {
  if (state.currentView === 'earth') return;
  state.currentView = 'earth';
  els.btnEarthView.classList.add('active');
  els.btnSpaceView.classList.remove('active');
  els.btnSurfaceView.classList.remove('active');
  els.btnHorizonView.classList.remove('active');
  document.body.classList.remove('horizon-mode');
  sceneManager.switchView('earth');
  els.rowAnimRev.style.display = 'flex';
  updateSpeedSlider();
  updateAll();
});

els.btnSurfaceView.addEventListener('click', () => {
  if (state.currentView === 'surface') return;
  state.currentView = 'surface';
  els.btnSurfaceView.classList.add('active');
  els.btnSpaceView.classList.remove('active');
  els.btnEarthView.classList.remove('active');
  els.btnHorizonView.classList.remove('active');
  document.body.classList.remove('horizon-mode'); // 依然属于宇宙大场景
  sceneManager.switchView('surface');
  els.rowAnimRev.style.display = 'none';
  updateSpeedSlider();
  updateAll();
});

els.btnHorizonView.addEventListener('click', () => {
  if (state.currentView === 'horizon') return;
  state.currentView = 'horizon';
  els.btnHorizonView.classList.add('active');
  els.btnSpaceView.classList.remove('active');
  els.btnEarthView.classList.remove('active');
  els.btnSurfaceView.classList.remove('active');
  document.body.classList.add('horizon-mode');
  sceneManager.switchView('horizon');
  els.rowAnimRev.style.display = 'none';
  updateSpeedSlider();
  updateAll();
});

els.btnResetCamera.addEventListener('click', () => {
  sceneManager.resetCamera();
});

// --- 快捷日期按钮 ---
document.querySelectorAll('.quick-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const month = parseInt(btn.dataset.month);
    const day = parseInt(btn.dataset.day);
    state.month = month;
    state.day = day;
    els.monthSlider.value = month;
    els.daySlider.value = day;
    els.daySlider.max = getDaysInMonth(month);
    els.monthValue.textContent = `${month}月`;
    els.dayValue.textContent = `${day}日`;
    state.doyFloat = getDayOfYear(state.month, state.day);
    updateAll();
  });
});

// --- 纬度预设按钮 ---
document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const lat = parseFloat(btn.dataset.lat);
    setActiveObserver(lat, state.longitude, null);
  });
});

// ===== 自动播放动画循环 =====
let lastTime = 0;

function animationLoop(timestamp) {
  requestAnimationFrame(animationLoop);

  if (!state.animRev && !state.animRot) {
    lastTime = timestamp;
    return;
  }

  const delta = (timestamp - lastTime) / 1000; // 秒
  lastTime = timestamp;

  if (delta > 0.1) return; // 跳过过大的时间跳跃（如切换标签页回来）

  let needsUpdate = false;

  // 根据当前视角决定动画行为
  if (state.currentView === 'space' || state.currentView === 'earth' || state.currentView === 'surface') {
    let currentSpeed = state.currentView === 'space' ? state.speedSpace : (state.currentView === 'earth' ? state.speedEarth : state.speedSurface);
    if (state.currentView === 'surface') currentSpeed *= (0.1 / 3);
    // 宇宙视角或地球视角：推进日期（公转演示），实地视角不再自动推进日期
    if (state.animRev && state.currentView !== 'surface') {
      // 速度1x = 每秒推进5天
      const dayAdvance = delta * currentSpeed * 5;
      state.doyFloat += dayAdvance;

      // 年循环
      if (state.doyFloat > 365) state.doyFloat -= 365;
      if (state.doyFloat < 1) state.doyFloat += 365;

      // 反向推算月日用于显示
      const { month, day } = dayOfYearToDate(Math.round(state.doyFloat));
      state.month = month;
      state.day = day;
      els.monthSlider.value = month;
      els.daySlider.value = day;
      els.daySlider.max = getDaysInMonth(month);
      els.monthValue.textContent = `${month}月`;
      els.dayValue.textContent = `${day}日`;
      needsUpdate = true;
    }

    // 宇宙视角或地球视角：推进时间（自转演示）
    if (state.animRot) {
      // 速度1x = 每秒推进24小时（一整圈）
      state.hour += delta * currentSpeed * 24;
      while (state.hour >= 24) state.hour -= 24;
      while (state.hour < 0) state.hour += 24;
      els.hourSlider.value = state.hour;
      els.hourValue.textContent = formatTime(state.hour);
      needsUpdate = true;
    }
  } else {
    // 地平视角：推进时间（日运动演示）
    if (state.animRot) {
      // 速度1x = 每秒推进1小时
      state.hour += delta * state.speedHorizon;
      if (state.hour >= 24) state.hour -= 24;
      if (state.hour < 0) state.hour += 24;
      els.hourSlider.value = state.hour;
      els.hourValue.textContent = formatTime(state.hour);
      needsUpdate = true;
    }
  }

  if (needsUpdate) {
    updateAll();
  }
}

/** 将一年中的第几天转换为月份和日期 */
function dayOfYearToDate(doy) {
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let remaining = Math.max(1, Math.min(365, doy));
  for (let m = 0; m < 12; m++) {
    if (remaining <= daysInMonth[m]) {
      return { month: m + 1, day: remaining };
    }
    remaining -= daysInMonth[m];
  }
  return { month: 12, day: 31 };
}

// ===== 启动 =====
sceneManager.onObjectDragged = (targetType, dx, dy) => {
  if (targetType === 'sun') {
    // 拖动太阳改变时间时，自动关闭“自动自转”
    if (state.animRot) {
      state.animRot = false;
      els.toggleAnimRot.checked = false;
    }
    
    // 地平视角：拖动太阳改变时间
    // 鼠标右移 (dx > 0) 代表时间往后推，进一步降低灵敏度
    state.hour += dx * 0.005;
    if (state.hour >= 24) state.hour -= 24;
    if (state.hour < 0) state.hour += 24;
    
    els.hourSlider.value = state.hour;
    els.hourValue.textContent = formatTime(state.hour);
    updateAll();
  } else if (targetType === 'earth') {
    // 拖动地球改变日期时，自动关闭“自动公转”
    if (state.animRev) {
      state.animRev = false;
      els.toggleAnimRev.checked = false;
    }

    // 宇宙视角：拖动地球改变日期（公转）
    // SceneManager已经通过3D投影计算出了完美的 logicalDx，
    // 使得无论从哪个角度看，拖拽方向都能与视觉直觉匹配，所以这里直接加就可以了。
    state.doyFloat += dx * 0.2;
    if (state.doyFloat > 365) state.doyFloat -= 365;
    if (state.doyFloat < 1) state.doyFloat += 365;
    
    const { month, day } = dayOfYearToDate(Math.round(state.doyFloat));
    state.month = month;
    state.day = day;
    els.monthSlider.value = month;
    els.daySlider.value = day;
    els.daySlider.max = getDaysInMonth(month);
    els.monthValue.textContent = `${month}月`;
    els.dayValue.textContent = `${day}日`;
    updateAll();
  }
};

renderLocationList();
updateAll();
requestAnimationFrame(animationLoop);

console.log('🌍 地球与太阳 - 3D地理演示系统已启动');
