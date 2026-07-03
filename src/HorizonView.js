// 地平视角模块 - 从地球表面某一位置观察天空穹顶
import * as THREE from 'three';
import { degToRad, radToDeg, getSolarDeclination, getSolarPosition, getSunriseHourAngle, getNoonAltitude, getDayLength, getMoonPosition } from './GeoMath.js';

// 天穹半径与地面半径常量
const SKY_RADIUS = 40;
const GROUND_RADIUS = 50;

export class HorizonView {
  /**
   * 构造函数 - 初始化地平视角场景
   * @param {THREE.Scene} scene - Three.js 场景对象
   */
  constructor(scene) {
    // 创建主分组并添加到场景
    this.group = new THREE.Group();
    scene.add(this.group);
    this.group.visible = false;

    // 标签与辅助线集合
    this.labels = [];
    this.helpers = [];

    // 缓存上一次的纬度与日期，避免重复构建轨迹
    this.prevLat = null;
    this.prevDay = null;

    // 轨迹相关对象，便于清理重建
    this.trajectoryObjects = [];

    // 高度指示器引用
    this.altitudeArc = null;
    this.altitudeLabel = null;

    // 调用各初始化方法
    this._createGround();
    this._createSkyDome();
    this._createCardinalDirections();
    this._createSunObject();
    this._createMoonObject();
    this._createHelpers();
  }

  /**
   * 创建地面 - 包含地面网格与罗盘十字线
   */
  _createGround() {
    // 地面圆盘
    const groundGeo = new THREE.CircleGeometry(GROUND_RADIUS, 64);
    groundGeo.rotateX(-Math.PI / 2); // 旋转使其水平放置
    const groundMat = new THREE.MeshPhongMaterial({
      color: 0x1a3a1a,
      transparent: true,
      opacity: 0.85
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    this.group.add(ground);

    // 地面网格辅助线
    const grid = new THREE.GridHelper(100, 20, 0x2a5a2a, 0x1a3a1a);
    this.group.add(grid);
    this.helpers.push(grid);

    // 罗盘十字线 - 南北线（Z轴方向）
    const nsPoints = [
      new THREE.Vector3(0, 0.05, -GROUND_RADIUS),
      new THREE.Vector3(0, 0.05, GROUND_RADIUS)
    ];
    const nsGeo = new THREE.BufferGeometry().setFromPoints(nsPoints);
    const compassMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const nsLine = new THREE.Line(nsGeo, compassMat);
    this.group.add(nsLine);

    // 罗盘十字线 - 东西线（X轴方向）
    const ewPoints = [
      new THREE.Vector3(-GROUND_RADIUS, 0.05, 0),
      new THREE.Vector3(GROUND_RADIUS, 0.05, 0)
    ];
    const ewGeo = new THREE.BufferGeometry().setFromPoints(ewPoints);
    const ewLine = new THREE.Line(ewGeo, compassMat.clone());
    this.group.add(ewLine);
  }

  /**
   * 创建天穹 - 上半球渐变天空
   */
  _createSkyDome() {
    // 上半球几何体
    const skyGeo = new THREE.SphereGeometry(SKY_RADIUS, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);

    // 天空渐变着色器材质
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: `
        // 顶点着色器 - 传递世界坐标
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        // 片段着色器 - 地平到天顶的颜色渐变
        varying vec3 vWorldPosition;
        void main() {
          // 计算归一化高度（0=地平线，1=天顶）
          float height = normalize(vWorldPosition).y;
          height = clamp(height, 0.0, 1.0);
          // 地平线颜色与天顶颜色混合
          vec3 horizonColor = vec3(0.15, 0.15, 0.25);
          vec3 zenithColor = vec3(0.02, 0.02, 0.1);
          vec3 color = mix(horizonColor, zenithColor, height);
          gl_FragColor = vec4(color, 0.7);
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false
    });

    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.group.add(skyDome);
  }

  /**
   * 创建四/八方位标识
   */
  _createCardinalDirections() {
    // 四个主方位
    const mainDirections = [
      { text: 'N', pos: new THREE.Vector3(0, 0.05, -SKY_RADIUS * 0.9), rotY: 0 },
      { text: 'S', pos: new THREE.Vector3(0, 0.05, SKY_RADIUS * 0.9), rotY: Math.PI },
      { text: 'E', pos: new THREE.Vector3(SKY_RADIUS * 0.9, 0.05, 0), rotY: -Math.PI / 2 },
      { text: 'W', pos: new THREE.Vector3(-SKY_RADIUS * 0.9, 0.05, 0), rotY: Math.PI / 2 }
    ];

    for (const dir of mainDirections) {
      const plane = this._createTextPlane(dir.text, '#ffffff', 100);
      plane.position.copy(dir.pos);
      plane.rotation.y = dir.rotY; // 文字朝向中心
      plane.scale.set(8, 4, 1);
      this.group.add(plane);
      this.labels.push(plane);
    }
  }

  /**
   * 创建太阳对象 - 包含发光球体、光晕精灵和点光源
   */
  _createSunObject() {
    // 太阳球体
    const sunGeo = new THREE.SphereGeometry(1.5, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffdd44 });
    this.sun = new THREE.Mesh(sunGeo, sunMat);
    this.group.add(this.sun);

    // 太阳光晕精灵（使用 Canvas 生成径向渐变纹理）
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 256;
    glowCanvas.height = 256;
    const ctx = glowCanvas.getContext('2d');
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255, 240, 180, 1.0)');
    gradient.addColorStop(0.2, 'rgba(255, 220, 100, 0.6)');
    gradient.addColorStop(0.5, 'rgba(255, 180, 50, 0.2)');
    gradient.addColorStop(1.0, 'rgba(255, 150, 0, 0.0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);

    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTexture,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    });
    this.sunGlow = new THREE.Sprite(glowMat);
    this.sunGlow.scale.set(8, 8, 1);
    this.sun.add(this.sunGlow);

    // 太阳点光源
    this.sunLight = new THREE.PointLight(0xfff5e0, 1.5, 200);
    this.sun.add(this.sunLight);

    // 太阳连接线（地点到太阳）
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, SKY_RADIUS, 0) // 初始占位
    ]);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0xffdd44,
      transparent: true,
      opacity: 0.6,
      dashSize: 1,
      gapSize: 0.5
    });
    this.sunConnectionLine = new THREE.Line(lineGeo, lineMat);
    this.sunConnectionLine.computeLineDistances();
    this.group.add(this.sunConnectionLine);
    this.helpers.push(this.sunConnectionLine);
  }

  /**
   * 创建月球对象 - 包含亮面Shader球体
   */
  _createMoonObject() {
    const moonGeo = new THREE.SphereGeometry(0.5, 32, 32); // 略微放大以便看清
    this.moonMat = new THREE.ShaderMaterial({
      uniforms: {
        sunPosition: { value: new THREE.Vector3(0, 0, 0) },
        opacity: { value: 1.0 }
      },
      transparent: true,
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 sunPosition;
        uniform float opacity;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        void main() {
          // 太阳在无限远处，光线为平行光。方向为从地心指向太阳位置。
          vec3 lightDir = normalize(sunPosition);
          float intensity = dot(vNormal, lightDir);
          vec3 brightColor = vec3(0.95, 0.93, 0.88);
          // 增加更清晰的地球反照光（地球光），使新月或暗面在天空中保留明晰可见轮廓，便于教学展示
          vec3 darkColor   = vec3(0.18, 0.20, 0.26);
          float t = smoothstep(-0.04, 0.04, intensity);
          gl_FragColor = vec4(mix(darkColor, brightColor, t), opacity);
        }
      `
    });
    this.moon = new THREE.Mesh(moonGeo, this.moonMat);
    this.moon.visible = true; // 默认可见，在地平线下半透明
    this.group.add(this.moon);

    // 月球连接线（地面中心到月球）
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, SKY_RADIUS, 0) // 初始占位
    ]);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.6,
      dashSize: 1,
      gapSize: 0.5
    });
    this.moonConnectionLine = new THREE.Line(lineGeo, lineMat);
    this.moonConnectionLine.computeLineDistances();
    this.group.add(this.moonConnectionLine);
    this.helpers.push(this.moonConnectionLine);
  }

  /**
   * 创建辅助参考线 - 高度圈、子午线、天顶标记
   */
  _createHelpers() {
    const helperMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.2
    });

    // 30° 和 60° 高度圈
    const altitudes = [30, 60];
    for (const altDeg of altitudes) {
      const altRad = degToRad(altDeg);
      const points = [];
      const segments = 128;
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const x = SKY_RADIUS * Math.cos(altRad) * Math.sin(theta);
        const y = SKY_RADIUS * Math.sin(altRad);
        const z = -SKY_RADIUS * Math.cos(altRad) * Math.cos(theta);
        points.push(new THREE.Vector3(x, y, z));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geo, helperMat.clone());
      this.group.add(line);
      this.helpers.push(line);
    }

    // 子午线弧 - 从北方地平线经天顶到南方地平线（在 x=0 的平面内）
    const meridianPoints = [];
    const meridianSegs = 64;
    for (let i = 0; i <= meridianSegs; i++) {
      const angle = (i / meridianSegs) * Math.PI; // 0 到 π
      const x = 0;
      const y = SKY_RADIUS * Math.sin(angle);
      const z = -SKY_RADIUS * Math.cos(angle); // 从北(-Z)到南(+Z)
      meridianPoints.push(new THREE.Vector3(x, y, z));
    }
    const meridianGeo = new THREE.BufferGeometry().setFromPoints(meridianPoints);
    const meridianLine = new THREE.Line(meridianGeo, helperMat.clone());
    this.group.add(meridianLine);
    this.helpers.push(meridianLine);

    // 天顶标记 - 小圆点
    const zenithGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const zenithMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const zenithDot = new THREE.Mesh(zenithGeo, zenithMat);
    zenithDot.position.set(0, SKY_RADIUS, 0);
    this.group.add(zenithDot);
    this.helpers.push(zenithDot);
  }

  /**
   * 构建太阳和月球日轨迹线
   * @param {number} latitudeDeg - 纬度（度）
   * @param {number} dayOfYear - 年内第几天
   * @param {number} moonDay - 月相日期 (1~30)
   */
  _buildTrajectory(latitudeDeg, dayOfYear, moonDay = 15) {
    // 清除旧轨迹对象
    for (const obj of this.trajectoryObjects) {
      this.group.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    }
    this.trajectoryObjects = [];

    // 每15分钟计算一次太阳位置（一天96个采样点）
    const allPoints = [];
    for (let h = 0; h <= 24; h += 0.25) {
      const pos = getSolarPosition(latitudeDeg, dayOfYear, h);
      const alt = pos.altitude;
      const az = pos.azimuth;
      // 转换为三维坐标
      const x = SKY_RADIUS * Math.cos(alt) * Math.sin(az);
      const y = SKY_RADIUS * Math.sin(alt);
      const z = -SKY_RADIUS * Math.cos(alt) * Math.cos(az);
      allPoints.push({ x, y, z, altitude: alt, azimuth: az, hour: h });
    }

    // 分离地平线以上与以下的点
    const abovePoints = [];
    const belowPoints = [];
    for (const p of allPoints) {
      if (p.altitude > -0.02) {
        abovePoints.push(p);
      } else {
        belowPoints.push(p);
      }
    }

    // 地平线以上轨迹 - 顶点着色（低仰角偏橙色，高仰角偏黄色）
    if (abovePoints.length > 1) {
      const positions = new Float32Array(abovePoints.length * 3);
      const colors = new Float32Array(abovePoints.length * 3);

      // 计算当天最大仰角用于归一化
      const maxAlt = Math.max(...abovePoints.map(p => p.altitude), 0.01);

      for (let i = 0; i < abovePoints.length; i++) {
        const p = abovePoints[i];
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = p.y;
        positions[i * 3 + 2] = p.z;

        // 颜色插值：低仰角橙色(1.0,0.5,0.0) -> 高仰角黄色(1.0,1.0,0.3)
        const t = Math.max(p.altitude, 0) / maxAlt;
        colors[i * 3] = 1.0;                      // R
        colors[i * 3 + 1] = 0.5 + 0.5 * t;       // G
        colors[i * 3 + 2] = 0.3 * t;              // B
      }

      const aboveGeo = new THREE.BufferGeometry();
      aboveGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      aboveGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const aboveMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        linewidth: 2
      });

      const aboveLine = new THREE.Line(aboveGeo, aboveMat);
      this.group.add(aboveLine);
      this.trajectoryObjects.push(aboveLine);
      this.sunTrajectoryAboveLine = aboveLine; // 保存引用
    }

    // 地平线以下轨迹 - 虚线
    if (belowPoints.length > 1) {
      const belowVerts = belowPoints.map(p => new THREE.Vector3(p.x, p.y, p.z));
      const belowGeo = new THREE.BufferGeometry().setFromPoints(belowVerts);

      const belowMat = new THREE.LineDashedMaterial({
        color: 0x666666,
        transparent: true,
        opacity: 0.3,
        dashSize: 0.5,
        gapSize: 0.5
      });

      const belowLine = new THREE.Line(belowGeo, belowMat);
      belowLine.computeLineDistances();
      this.group.add(belowLine);
      this.trajectoryObjects.push(belowLine);
      this.sunTrajectoryBelowLine = belowLine; // 保存引用
    }

    // 3. 月球视轨迹绘制 (浅蓝色虚线)
    const moonPoints = [];
    for (let h = 0; h <= 24; h += 0.25) {
      const pos = getMoonPosition(latitudeDeg, dayOfYear, h, moonDay);
      const alt = pos.altitude;
      const az = pos.azimuth;

      const x = SKY_RADIUS * Math.cos(alt) * Math.sin(az);
      const y = SKY_RADIUS * Math.sin(alt);
      const z = -SKY_RADIUS * Math.cos(alt) * Math.cos(az);

      moonPoints.push(new THREE.Vector3(x, y, z));
    }

    if (moonPoints.length > 1) {
      const moonGeo = new THREE.BufferGeometry().setFromPoints(moonPoints);
      const moonMat = new THREE.LineDashedMaterial({
        color: 0x88ccff,
        transparent: true,
        opacity: 0.5,
        dashSize: 0.8,
        gapSize: 0.5
      });
      const moonLine = new THREE.Line(moonGeo, moonMat);
      moonLine.computeLineDistances();
      this.group.add(moonLine);
      this.trajectoryObjects.push(moonLine);
      this.moonTrajectoryLine = moonLine; // 保存引用
    }
  }

  /**
   * 创建高度角指示器（已移除，不直接在天空显示）
   */

  /**
   * 更新地平视角的所有元素
   * @param {number} latitudeDeg - 纬度（度）
   * @param {number} dayOfYear - 年内第几天
   * @param {number} timeOfDay - 当前时刻（小时，浮点数）
   * @param {boolean} showHelpers - 是否显示辅助线
   * @param {boolean} showLabels - 是否显示标签
   * @param {number} moonDay - 月相日期 (1~30)
   * @param {boolean} showSun - 是否显示太阳
   * @param {boolean} showMoon - 是否显示月球
   */
  update(latitudeDeg, dayOfYear, timeOfDay, showHelpers, showLabels, moonDay = 15, showSun = true, showMoon = true) {
    // 纬度、日期或月球日期变化时重建轨迹
    if (latitudeDeg !== this.prevLat || dayOfYear !== this.prevDay || moonDay !== this.prevMoonDay) {
      this._buildTrajectory(latitudeDeg, dayOfYear, moonDay);
      this.prevLat = latitudeDeg;
      this.prevDay = dayOfYear;
      this.prevMoonDay = moonDay;
    }

    // 计算当前太阳位置
    const sunPos = getSolarPosition(latitudeDeg, dayOfYear, timeOfDay);
    const alt = sunPos.altitude;
    const az = sunPos.azimuth;

    // 转换为三维坐标并更新太阳位置
    const sunX = SKY_RADIUS * Math.cos(alt) * Math.sin(az);
    const sunY = SKY_RADIUS * Math.sin(alt);
    const sunZ = -SKY_RADIUS * Math.cos(alt) * Math.cos(az);
    this.sun.position.set(sunX, sunY, sunZ);

    // 更新太阳连接线
    if (this.sunConnectionLine) {
      const positions = this.sunConnectionLine.geometry.attributes.position.array;
      positions[3] = sunX;
      positions[4] = sunY;
      positions[5] = sunZ;
      this.sunConnectionLine.geometry.attributes.position.needsUpdate = true;
      this.sunConnectionLine.computeLineDistances();
      
      // 太阳在地平线以下时也降低连接线的透明度
      if (alt < 0) {
        this.sunConnectionLine.material.opacity = 0.15;
      } else {
        this.sunConnectionLine.material.opacity = 0.6;
      }
    }

    // 太阳在地平线以下时降低亮度，若设为隐藏则彻底关闭光源与本体
    this.sun.visible = showSun;
    if (alt < 0) {
      this.sun.material.opacity = 0.2;
      this.sun.material.transparent = true;
      this.sunGlow.material.opacity = 0.2;
      this.sunLight.intensity = showSun ? 0.1 : 0.0;
    } else {
      this.sun.material.opacity = 1.0;
      this.sun.material.transparent = false;
      this.sunGlow.material.opacity = 1.0;
      this.sunLight.intensity = showSun ? 1.5 : 0.0;
    }

    // 计算当前月球的角坐标与三维直角坐标
    const moonPos = getMoonPosition(latitudeDeg, dayOfYear, timeOfDay, moonDay);
    const moonAlt = moonPos.altitude;
    const moonAz = moonPos.azimuth;

    const moonX = SKY_RADIUS * Math.cos(moonAlt) * Math.sin(moonAz);
    const moonY = SKY_RADIUS * Math.sin(moonAlt);
    const moonZ = -SKY_RADIUS * Math.cos(moonAlt) * Math.cos(moonAz);

    if (this.moon) {
      this.moon.position.set(moonX, moonY, moonZ);

      // 月相Shader的太阳位置更新
      if (this.moonMat) {
        this.moonMat.uniforms.sunPosition.value.set(sunX, sunY, sunZ);
        
        // 位于地平线以下时变为半透明 (0.2)，在地上时全透明 (1.0)
        if (moonAlt < 0) {
          this.moonMat.uniforms.opacity.value = 0.2;
        } else {
          this.moonMat.uniforms.opacity.value = 1.0;
        }
      }
      this.moon.visible = showMoon; // 根据控制显示/隐藏
    }

    // 更新高度角指示器：太阳（金黄色）与月球（浅蓝色），只标记名称，不带数字值，根据控制决定是否创建显示
    this._updateAltitudeIndicator('sun', alt, az, 0xff9800, showSun);
    this._updateAltitudeIndicator('moon', moonAlt, moonAz, 0x88ccff, showMoon);

    // 更新月球连接线
    if (this.moonConnectionLine) {
      const positions = this.moonConnectionLine.geometry.attributes.position.array;
      positions[3] = moonX;
      positions[4] = moonY;
      positions[5] = moonZ;
      this.moonConnectionLine.geometry.attributes.position.needsUpdate = true;
      this.moonConnectionLine.computeLineDistances();
      
      // 位于地平线以下时降低连接线透明度
      if (moonAlt < 0) {
        this.moonConnectionLine.material.opacity = 0.15;
      } else {
        this.moonConnectionLine.material.opacity = 0.6;
      }
    }

    // 更新光源方向（使其照向场景中心）
    this.sunLight.position.set(0, 0, 0); // 点光源附着在太阳上，位置相对太阳

    // 切换辅助线可见性
    for (const helper of this.helpers) {
      helper.visible = showHelpers;
    }
    
    // 如果太阳或月亮被隐藏，则其连接线即使在辅助线开启时也应该保持隐藏
    if (this.sunConnectionLine) {
      this.sunConnectionLine.visible = showHelpers && showSun;
    }
    if (this.moonConnectionLine) {
      this.moonConnectionLine.visible = showHelpers && showMoon;
    }

    // 强制同步太阳和月球的运行轨迹线可见性（辅助线开启且天体未隐藏时显示）
    if (this.sunTrajectoryAboveLine) {
      this.sunTrajectoryAboveLine.visible = showHelpers && showSun;
    }
    if (this.sunTrajectoryBelowLine) {
      this.sunTrajectoryBelowLine.visible = showHelpers && showSun;
    }
    if (this.moonTrajectoryLine) {
      this.moonTrajectoryLine.visible = showHelpers && showMoon;
    }

    // 切换标签可见性
    for (const label of this.labels) {
      label.visible = showLabels;
    }
  }

  /**
   * 创建文字精灵
   * @param {string} text - 显示文本
   * @param {string} color - 文字颜色
   * @param {number} fontSize - 字体大小
   * @returns {THREE.Sprite} 文字精灵
   */
  _createTextSprite(text, color = '#ffffff', fontSize = 36) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // 透明背景
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 绘制文字
    ctx.font = `bold ${fontSize}px "Microsoft YaHei", "PingFang SC", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 文字阴影增强可读性
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    ctx.fillStyle = color;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false
    });

    const sprite = new THREE.Sprite(spriteMat);
    return sprite;
  }

  /**
   * 创建印在地面上的文字平面
   * @param {string} text - 显示文本
   * @param {string} color - 文字颜色
   * @param {number} fontSize - 字体大小
   * @returns {THREE.Mesh} 平面网格
   */
  _createTextPlane(text, color = '#ffffff', fontSize = 64) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256; // 使平面更适合文字的长宽比
    const ctx = canvas.getContext('2d');

    // 透明背景
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 绘制文字
    ctx.font = `bold ${fontSize}px "Microsoft YaHei", "PingFang SC", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 文字阴影增强可读性
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    ctx.fillStyle = color;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const planeMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    });

    const planeGeo = new THREE.PlaneGeometry(1, 0.5); // 宽高比和canvas一致
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.renderOrder = 1;
    
    // 旋转平贴在 XZ 地面上
    // 改为 YXZ 旋转顺序：先绕 Y 轴旋转朝向，再绕 X 轴躺平
    plane.rotation.order = 'YXZ';
    plane.rotation.x = -Math.PI / 2;
    
    return plane;
  }

  /**
   * 更新高度角指示弧线（只标文字，不带数字度数）
   * @param {string} type - 'sun' | 'moon'
   * @param {number} altitude - 仰角（弧度）
   * @param {number} azimuth - 方位角（弧度）
   * @param {number} colorHex - 弧线颜色
   * @param {boolean} show - 是否显示
   */
  _updateAltitudeIndicator(type, altitude, azimuth, colorHex = 0xff9800, show = true) {
    const arcProp = `${type}AltitudeArc`;
    const labelProp = `${type}AltitudeLabel`;

    // 清除旧的高度弧
    if (this[arcProp]) {
      this.group.remove(this[arcProp]);
      if (this[arcProp].geometry) this[arcProp].geometry.dispose();
      if (this[arcProp].material) this[arcProp].material.dispose();
      this[arcProp] = null;
    }

    // 清除旧的高度标签
    if (this[labelProp]) {
      this.group.remove(this[labelProp]);
      if (this[labelProp].material && this[labelProp].material.map) {
        this[labelProp].material.map.dispose();
      }
      if (this[labelProp].material) this[labelProp].material.dispose();
      this[labelProp] = null;
    }

    // 仰角小于等于0或隐藏时不显示
    if (altitude <= 0 || !show) return;

    // 在星体方位角所在的垂直平面内，绘制从地平线到星体仰角的弧
    const arcPoints = [];
    const arcSegments = 20;
    // 太阳使用0.6，月球使用0.55，防止重合
    const arcRadius = SKY_RADIUS * (type === 'sun' ? 0.6 : 0.55);

    for (let i = 0; i <= arcSegments; i++) {
      const a = (i / arcSegments) * altitude; // 从0到当前仰角
      const x = arcRadius * Math.cos(a) * Math.sin(azimuth);
      const y = arcRadius * Math.sin(a);
      const z = -arcRadius * Math.cos(a) * Math.cos(azimuth);
      arcPoints.push(new THREE.Vector3(x, y, z));
    }

    const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints);
    const arcMat = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.8,
      linewidth: 2
    });

    this[arcProp] = new THREE.Line(arcGeo, arcMat);
    this.group.add(this[arcProp]);
  }

  /**
   * 设置地平视角的可见性
   * @param {boolean} visible - 是否可见
   */
  setVisible(visible) {
    this.group.visible = visible;
  }

  /**
   * 销毁所有资源 - 遍历并释放几何体、材质、纹理
   */
  dispose() {
    this.group.traverse((obj) => {
      if (obj.geometry) {
        obj.geometry.dispose();
      }
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(mat => {
            if (mat.map) mat.map.dispose();
            mat.dispose();
          });
        } else {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      }
    });

    // 从父级移除分组
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
  }
}
