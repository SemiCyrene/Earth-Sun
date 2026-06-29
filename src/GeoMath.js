/**
 * GeoMath.js - 地理天文计算模块
 * 包含太阳位置、昼夜长短等核心算法
 */

// ===== 常量 =====
export const AXIAL_TILT = 23.44;  // 黄赤交角（度）
export const AXIAL_TILT_RAD = AXIAL_TILT * Math.PI / 180;

// ===== 基础工具函数 =====

/** 角度转弧度 */
export function degToRad(deg) {
  return deg * Math.PI / 180;
}

/** 弧度转角度 */
export function radToDeg(rad) {
  return rad * 180 / Math.PI;
}

// ===== 日期相关 =====

/**
 * 获取一年中的第几天 (1-366)
 * @param {number} month - 月份 (1-12)
 * @param {number} day - 日期 (1-31)
 * @returns {number} 一年中的第几天
 */
export function getDayOfYear(month, day) {
  const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let n = 0;
  for (let i = 1; i < month; i++) {
    n += daysInMonth[i];
  }
  return n + day;
}

/**
 * 获取指定月份的最大天数
 * @param {number} month - 月份 (1-12)
 * @returns {number} 该月最大天数
 */
export function getDaysInMonth(month) {
  const days = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month] || 31;
}

// ===== 太阳位置核心算法 =====

/**
 * 根据天数计算太阳黄经（弧度）
 * 采用四大节气为绝对锔点的分段差射插值，确保春秋分少阳赤纬角绝对为0
 * 镄点: 春分(3/21 第80天)=0°, 夏至(6/21 第172天)=90°,
 *       秋分(9/23 第266天)=180°, 冬至(12/22 第356天)=270°
 * @param {number} dayOfYear - 一年中的第几天 (1-365)
 * @returns {number} 太阳黄经（弧度，0~2π）
 */
function getEclipticLongitude(dayOfYear) {
  // 四大节气锔点 [dayOfYear, lambda_degrees]
  const anchors = [
    [80,  0],
    [172, 90],
    [266, 180],
    [356, 270],
    [80 + 365, 360], // 回到下一个春分
  ];

  // 将春分之前的天数归一化到冬至后的区间
  let d = dayOfYear;
  if (d < 80) d += 365;

  for (let i = 0; i < anchors.length - 1; i++) {
    const [d0, l0] = anchors[i];
    const [d1, l1] = anchors[i + 1];
    if (d >= d0 && d <= d1) {
      const t = (d - d0) / (d1 - d0);
      return degToRad(l0 + t * (l1 - l0));
    }
  }
  return 0;
}

/**
 * 根据一年中的天数计算太阳赤纬角（弧度）
 * 公式: sin(δ) = sin(23.44°) × sin(λ)  [天文学标准黄经公式]
 * 確保春秋分赤纬角绝对=0，夏冬至赤纬角绝对=±23.44°
 * @param {number} dayOfYear - 一年中的第几天
 * @returns {number} 太阳赤纬角（弧度）
 */
export function getSolarDeclination(dayOfYear) {
  const lambda = getEclipticLongitude(dayOfYear);
  return Math.asin(Math.sin(AXIAL_TILT_RAD) * Math.sin(lambda));
}

/**
 * 计算太阳高度角（弧度）
 * 公式: sin(h) = sin(φ)sin(δ) + cos(φ)cos(δ)cos(ω)
 * @param {number} latitude - 观察者纬度（弧度，北纬为正）
 * @param {number} declination - 太阳赤纬（弧度）
 * @param {number} hourAngle - 时角（弧度，正午为0，下午为正）
 * @returns {number} 太阳高度角（弧度）
 */
export function getSolarAltitude(latitude, declination, hourAngle) {
  const sinAlt = Math.sin(latitude) * Math.sin(declination) +
                 Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt)));
}

/**
 * 计算太阳方位角（弧度，从正北顺时针）
 * 公式: cos(A) = (sin(δ) - sin(h)·sin(φ)) / (cos(h)·cos(φ))
 * 根据时角判断东西方向：上午时角<0 方位角在0-180°(北→东→南)，下午时角>0 方位角在180-360°(南→西→北)
 * @param {number} latitude - 观察者纬度（弧度）
 * @param {number} declination - 太阳赤纬（弧度）
 * @param {number} hourAngle - 时角（弧度）
 * @param {number} altitude - 太阳高度角（弧度）
 * @returns {number} 太阳方位角（弧度，从正北顺时针 0~2π）
 */
export function getSolarAzimuth(latitude, declination, hourAngle, altitude) {
  const cosLat = Math.cos(latitude);

  // 极点特殊处理：方位角由时角直接决定
  if (Math.abs(cosLat) < 0.0001) {
    let az = hourAngle + Math.PI;
    while (az < 0) az += 2 * Math.PI;
    while (az >= 2 * Math.PI) az -= 2 * Math.PI;
    return az;
  }

  const cosAlt = Math.cos(altitude);

  // 太阳在天顶（高度角≈90°）
  if (Math.abs(cosAlt) < 0.0001) {
    return 0;
  }

  let cosAz = (Math.sin(declination) - Math.sin(altitude) * Math.sin(latitude)) /
              (cosAlt * cosLat);
  // 数值安全截断
  cosAz = Math.max(-1, Math.min(1, cosAz));
  let azimuth = Math.acos(cosAz);

  // 下午（时角>0）方位角在 180°~360° 范围
  if (hourAngle > 0) {
    azimuth = 2 * Math.PI - azimuth;
  }

  return azimuth;
}

/**
 * 计算日出时角（弧度，返回正值）
 * 公式: cos(ω₀) = -tan(φ)·tan(δ)
 * @param {number} latitude - 观察者纬度（弧度）
 * @param {number} declination - 太阳赤纬（弧度）
 * @returns {number} 日出时角（弧度）。极昼返回 π，极夜返回 0
 */
export function getSunriseHourAngle(latitude, declination) {
  const tanProduct = -Math.tan(latitude) * Math.tan(declination);
  if (tanProduct <= -1) return Math.PI;  // 极昼：太阳全天不落
  if (tanProduct >= 1) return 0;          // 极夜：太阳全天不升
  return Math.acos(tanProduct);
}

/**
 * 计算昼长（小时）
 * @param {number} latitude - 观察者纬度（弧度）
 * @param {number} declination - 太阳赤纬（弧度）
 * @returns {number} 昼长（小时，0~24）
 */
export function getDayLength(latitude, declination) {
  const ha = getSunriseHourAngle(latitude, declination);
  return (2 * ha) / degToRad(15); // 每小时对应15°时角
}

/**
 * 计算正午太阳高度角（弧度）
 * 公式: H = 90° - |φ - δ|
 * @param {number} latitude - 观察者纬度（弧度）
 * @param {number} declination - 太阳赤纬（弧度）
 * @returns {number} 正午太阳高度角（弧度）
 */
export function getNoonAltitude(latitude, declination) {
  return degToRad(90) - Math.abs(latitude - declination);
}

// ===== 综合计算函数 =====

/**
 * 综合函数：给定纬度(度)、一年中的天数、一天中的小时(0-24)，
 * 返回太阳的位置
 * @param {number} latitudeDeg - 观察者纬度（度，北纬为正）
 * @param {number} dayOfYear - 一年中的第几天
 * @param {number} hour - 一天中的小时 (0~24，12为正午)
 * @returns {{altitude: number, azimuth: number}} 太阳高度角和方位角（弧度）
 */
export function getSolarPosition(latitudeDeg, dayOfYear, hour) {
  const latRad = degToRad(latitudeDeg);
  const declination = getSolarDeclination(dayOfYear);
  const hourAngle = degToRad((hour - 12) * 15); // 正午时角为0，每小时15°
  const altitude = getSolarAltitude(latRad, declination, hourAngle);
  const azimuth = getSolarAzimuth(latRad, declination, hourAngle, altitude);
  return { altitude, azimuth };
}

/**
 * 获取地球公转轨道角度（弧度）
 * 以黄经模型为基准，确保3D场景中地球位置与赤纬角模型完全同步
 * 春分时轨道角度=0, 夏至=90°, 秋分=180°, 冬至=270°
 * @param {number} dayOfYear - 一年中的第几天
 * @returns {number} 公转角度（弧度）
 */
export function getEarthOrbitalAngle(dayOfYear) {
  return getEclipticLongitude(dayOfYear);
}

// ===== 文字描述函数 =====

/**
 * 获取月份和日期对应的节气/季节描述
 * @param {number} month - 月份 (1-12)
 * @param {number} day - 日期 (1-31)
 * @returns {string} 节气名称或季节描述
 */
export function getDateLabel(month, day) {
  // 四大节气精确判断
  if (month === 3 && day >= 20 && day <= 22) return '春分';
  if (month === 6 && day >= 21 && day <= 22) return '夏至';
  if (month === 9 && day >= 22 && day <= 24) return '秋分';
  if (month === 12 && day >= 21 && day <= 23) return '冬至';

  // 季节区间描述
  const doy = getDayOfYear(month, day);
  if (doy >= 81 && doy < 172) return '春分→夏至';
  if (doy >= 172 && doy < 266) return '夏至→秋分';
  if (doy >= 266 && doy < 356) return '秋分→冬至';
  return '冬至→春分';
}

/**
 * 获取当前日期和纬度的地理现象描述文本
 * @param {number} month - 月份
 * @param {number} day - 日期
 * @param {number} latitudeDeg - 观察者纬度（度）
 * @returns {string} 地理现象的详细中文描述
 */
export function getGeoDescription(month, day, latitudeDeg) {
  const doy = getDayOfYear(month, day);
  const decl = getSolarDeclination(doy);
  const declDeg = radToDeg(decl);
  const latRad = degToRad(latitudeDeg);

  // === 太阳直射点纬度描述 ===
  let subsolarDesc = '';
  if (Math.abs(declDeg) < 0.5) {
    subsolarDesc = '赤道附近';
  } else if (declDeg > 0) {
    subsolarDesc = `北纬${declDeg.toFixed(1)}°`;
  } else {
    subsolarDesc = `南纬${Math.abs(declDeg).toFixed(1)}°`;
  }

  // === 昼长计算 ===
  const dayLen = getDayLength(latRad, decl);
  const dayH = Math.floor(dayLen);
  const dayM = Math.round((dayLen - dayH) * 60);

  // === 正午太阳高度角 ===
  const noonAlt = radToDeg(getNoonAltitude(latRad, decl));

  // === 构建描述文本 ===
  let desc = `☀️ 太阳直射点位于${subsolarDesc}。\n`;

  // 极昼极夜判断
  const ha = getSunriseHourAngle(latRad, decl);
  if (Math.abs(ha - Math.PI) < 0.01) {
    desc += `🌞 当前纬度(${latitudeDeg}°)出现极昼现象，太阳全天不落。\n`;
  } else if (Math.abs(ha) < 0.01) {
    desc += `🌑 当前纬度(${latitudeDeg}°)出现极夜现象，太阳全天不升。\n`;
  } else {
    desc += `⏱ 当前纬度昼长约${dayH}小时${dayM}分钟。\n`;
    // 是否春秋分（允许宽松容差 0.15小时）
    const isEquinox = Math.abs(dayLen - 12) < 0.15;
    if (dayLen > 12.15) {
      desc += `📏 昼长夜短。\n`;
    } else if (dayLen < 11.85) {
      desc += `📏 昼短夜长。\n`;
    } else {
      desc += `📏 昼夜近似等长。\n`;
    }
  }

  desc += `📐 正午太阳高度角约${noonAlt.toFixed(1)}°。`;

  // === 特殊节气补充说明 ===
  const label = getDateLabel(month, day);
  if (label === '春分') {
    desc += `\n\n🌱 春分日：太阳直射赤道，全球昼夜等长。此后太阳直射点向北移动。`;
  } else if (label === '夏至') {
    desc += `\n\n☀️ 夏至日：太阳直射北回归线(23°26'N)，北半球昼最长夜最短，北极圈内出现极昼，南极圈内出现极夜。`;
  } else if (label === '秋分') {
    desc += `\n\n🍂 秋分日：太阳直射赤道，全球昼夜等长。此后太阳直射点向南移动。`;
  } else if (label === '冬至') {
    desc += `\n\n❄️ 冬至日：太阳直射南回归线(23°26'S)，北半球昼最短夜最长，南极圈内出现极昼，北极圈内出现极夜。`;
  }

  return desc;
}
