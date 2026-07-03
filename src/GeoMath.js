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

// ===== 月球相关计算 =====

/**
 * 根据月相日期 (1~30) 计算理想化月相夹角（弧度）
 * 教学理想化对应关系：农历初一=0, 初八=π/2 (90°), 十五=π (180°), 廿三=3π/2 (270°), 三十=2π
 * @param {number} moonDay - 月相日期 (1-30)
 * @returns {number} 月相夹角（弧度）
 */
export function getMoonPhaseAngle(moonDay) {
  const d = moonDay;
  if (d < 8) {
    return ((d - 1) / 7) * (Math.PI / 2);
  } else if (d < 15) {
    return Math.PI / 2 + ((d - 8) / 7) * (Math.PI / 2);
  } else if (d < 23) {
    return Math.PI + ((d - 15) / 8) * (Math.PI / 2);
  } else {
    // 教学理想化：下一次初一（新月，0°/360°）对应第 29.53 + 1 = 30.53 天。
    // 这使得“农历三十”成为晦日（极窄的残月），只有到了下个月初一才重新闭合为新月。
    const maxDay = 29.53 + 1;
    if (d >= maxDay) return 0;
    return (3 * Math.PI / 2) + ((d - 23) / (maxDay - 23)) * (Math.PI / 2);
  }
}

/**
 * 根据月相角返回月相名称
 * @param {number} phaseAngle - 月相角（弧度）
 * @returns {string} 月相名称
 */
export function getMoonPhaseName(phaseAngle) {
  // 归一化到 [0, 2π)
  const a = ((phaseAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const deg = a * 180 / Math.PI;
  if (deg < 22.5 || deg >= 337.5) return '🌑 新月';
  if (deg < 67.5) return '🌒 蛾眉月';
  if (deg < 112.5) return '🌓 上弦月';
  if (deg < 157.5) return '🌔 盈凸月';
  if (deg < 202.5) return '🌕 满月';
  if (deg < 247.5) return '🌖 亏凸月';
  if (deg < 292.5) return '🌗 下弦月';
  return '🌘 残月';
}

/**
 * 计算月球的高度角和方位角（弧度）
 * @param {number} latitudeDeg - 观察者纬度（度，北纬为正）
 * @param {number} dayOfYear - 一年中的第几天
 * @param {number} hour - 一天中的小时 (0~24)
 * @param {number} moonDay - 月相日期 (1~30)
 * @returns {{altitude: number, azimuth: number}} 月球高度角和方位角（弧度）
 */
export function getMoonPosition(latitudeDeg, dayOfYear, hour, moonDay = 15) {
  const i = 0.0; // 月轨倾角 (已根据教学需求理想化抹平为0)
  const T = 23.44 * Math.PI / 180; // 黄赤交角
  const D = 3.5; // 轨道半径

  // 1. 获取地球公转角及太阳地心黄经
  const orbitalAngle = getEarthOrbitalAngle(dayOfYear);
  const lambda_sun = orbitalAngle + Math.PI; // 地心视太阳黄经

  // 2. 根据月相日期计算月相角 (使用理想化插值函数)
  const moonPhaseAngle = getMoonPhaseAngle(moonDay);

  // 3. 计算月球在黄道面中的绝对位置 (基于太阳黄经以消除公转导致的相位平移)
  const L_moon = lambda_sun + moonPhaseAngle;
  const mx = D * Math.cos(L_moon);
  const mz = -D * Math.sin(L_moon);

  // 绕 X 轴旋转 i (月轨倾斜)
  const mx_tilt = mx;
  const my_tilt = mz * Math.sin(i);
  const mz_tilt = mz * Math.cos(i);

  // 4. 将其转换到赤道坐标系中 (equatorial frame)
  // 绕 X 轴旋转 -T (赤道倾斜)
  const cosT = Math.cos(-T);
  const sinT = Math.sin(-T);
  const vx = mx_tilt;
  const vy = my_tilt * cosT - mz_tilt * sinT;
  const vz = my_tilt * sinT + mz_tilt * cosT;

  // 月球赤纬和赤经
  const declination = Math.asin(vy / D);
  const alpha_m = Math.atan2(vz, vx);

  // 5. 计算太阳的赤经以获取本地恒星时
  // 太阳在黄道坐标系中的位置 (相对于地球是相反方向)
  const sx = -Math.cos(orbitalAngle);
  const sy = 0;
  const sz = Math.sin(orbitalAngle);

  // 太阳转换到赤道坐标系
  const svx = sx;
  const svy = sy * cosT - sz * sinT;
  const svz = sy * sinT + sz * cosT;
  const alpha_s = Math.atan2(svz, svx);

  // 6. 计算月球时角
  const hourAngleSun = degToRad((hour - 12) * 15);
  // LST = hourAngleSun + alpha_s
  // hourAngleMoon = LST - alpha_m
  let hourAngleMoon = hourAngleSun + alpha_s - alpha_m;
  
  // 归一化到 [-π, π]
  hourAngleMoon = Math.atan2(Math.sin(hourAngleMoon), Math.cos(hourAngleMoon));

  // 7. 计算高度角和方位角
  const latRad = degToRad(latitudeDeg);
  const altitude = getSolarAltitude(latRad, declination, hourAngleMoon);
  const azimuth = getSolarAzimuth(latRad, declination, hourAngleMoon, altitude);

  return { altitude, azimuth };
}

/**
 * 获取月球的赤纬（弧度，考虑季节变化）
 * @param {number} dayOfYear - 一年中的第几天
 * @param {number} moonDay - 月相日期 (1~30)
 * @returns {number} 月球赤纬（弧度）
 */
export function getMoonDeclination(dayOfYear, moonDay) {
  const i = 0.0; // 月轨倾角 (已根据教学需求理想化抹平为0)
  const T = 23.44 * Math.PI / 180; // 黄赤交角
  const D = 3.5; // 轨道半径

  const orbitalAngle = getEarthOrbitalAngle(dayOfYear);
  const lambda_sun = orbitalAngle + Math.PI;
  const moonPhaseAngle = getMoonPhaseAngle(moonDay);
  const L_moon = lambda_sun + moonPhaseAngle;

  const mx = D * Math.cos(L_moon);
  const mz = -D * Math.sin(L_moon);

  const mx_tilt = mx;
  const my_tilt = mz * Math.sin(i);
  const mz_tilt = mz * Math.cos(i);

  const cosT = Math.cos(-T);
  const sinT = Math.sin(-T);
  const vy = my_tilt * cosT - mz_tilt * sinT;

  return Math.asin(vy / D);
}

/**
 * 计算当天的月球最大高度角（弧度，考虑季节变化）
 * @param {number} latitudeDeg - 观察者纬度（度）
 * @param {number} dayOfYear - 一年中的第几天
 * @param {number} moonDay - 月相日期 (1~30)
 * @returns {number} 最大高度角（弧度）
 */
export function getMoonMaxAltitude(latitudeDeg, dayOfYear, moonDay) {
  const latRad = degToRad(latitudeDeg);
  const decl = getMoonDeclination(dayOfYear, moonDay);
  return Math.PI / 2 - Math.abs(latRad - decl);
}

/**
 * 计算月球在给定纬度和日期的月升与月落时间
 * @param {number} latitudeDeg - 观察者纬度 (度)
 * @param {number} dayOfYear - 一年中的第几天 (1-366)
 * @param {number} moonDay - 月相日期 (1-30)
 * @returns {{rise: string, set: string}} 月升和月落时间描述 (格式如 "18:24")
 */
export function getMoonRiseSetTimes(latitudeDeg, dayOfYear, moonDay = 15) {
  const latRad = degToRad(latitudeDeg);
  const declination = getMoonDeclination(dayOfYear, moonDay);
  const ha = getSunriseHourAngle(latRad, declination);

  // 极昼极夜判断
  if (ha >= Math.PI - 0.001) {
    return { rise: '全天不落', set: '全天不落' };
  }
  if (ha <= 0.001) {
    return { rise: '全天不升', set: '全天不升' };
  }

  // 计算太阳和月球的赤经以获取中天时差
  const orbitalAngle = getEarthOrbitalAngle(dayOfYear);
  const T = 23.44 * Math.PI / 180; // 黄赤交角
  const cosT = Math.cos(-T);
  const sinT = Math.sin(-T);

  // 1. 太阳赤道坐标
  const sx = -Math.cos(orbitalAngle);
  const sy = 0;
  const sz = Math.sin(orbitalAngle);
  const svx = sx;
  const svy = sy * cosT - sz * sinT;
  const svz = sy * sinT + sz * cosT;
  const alpha_s = Math.atan2(svz, svx);

  // 2. 月球赤道坐标 (基于扁平轨道 i = 0)
  const lambda_sun = orbitalAngle + Math.PI;
  const moonPhaseAngle = getMoonPhaseAngle(moonDay);
  const L_moon = lambda_sun + moonPhaseAngle;
  const D = 3.5;
  const mx = D * Math.cos(L_moon);
  const mz = -D * Math.sin(L_moon);
  
  // i = 0.0, 所以 my_tilt = 0, mz_tilt = mz
  const mvx = mx;
  const mvy = -mz * sinT;
  const mvz = mz * cosT;
  const alpha_m = Math.atan2(mvz, mvx);

  // 3. 计算月球本地中天时刻 (transit time in local solar hours)
  // 太阳时角为 H_s = alpha_m - alpha_s 时月球中天
  // H_s = (t - 12) * 15° -> t = 12 + H_s * 12 / PI
  let H_s = alpha_m - alpha_s;
  // 归一化到 [-PI, PI]
  H_s = Math.atan2(Math.sin(H_s), Math.cos(H_s));
  
  let t_transit = 12 + H_s * 12 / Math.PI;
  t_transit = (t_transit % 24 + 24) % 24;

  // 4. 计算月升和月落时间
  const hourDiff = ha * 12 / Math.PI;
  let t_rise = (t_transit - hourDiff + 24) % 24;
  let t_set = (t_transit + hourDiff + 24) % 24;

  // 5. 计算月升和月落的方位角 (以正北为0，顺时针为正)
  const cosLat = Math.cos(latRad);
  let riseAz = 0;
  let setAz = 0;
  if (Math.abs(cosLat) >= 0.0001) {
    let cosA = Math.sin(declination) / cosLat;
    cosA = Math.max(-1, Math.min(1, cosA));
    const A = Math.acos(cosA);
    riseAz = A;
    setAz = 2 * Math.PI - A;
  }

  // 格式化为 "HH:MM"
  const formatTimeStr = (t) => {
    const h = Math.floor(t);
    const m = Math.round((t - h) * 60);
    // 再次处理 round 之后的 60 分钟进位问题
    let finalH = h;
    let finalM = m;
    if (finalM >= 60) {
      finalM = 0;
      finalH = (finalH + 1) % 24;
    }
    return `${finalH.toString().padStart(2, '0')}:${finalM.toString().padStart(2, '0')}`;
  };

  return {
    rise: formatTimeStr(t_rise),
    set: formatTimeStr(t_set),
    riseAz: riseAz,
    setAz: setAz
  };
}

