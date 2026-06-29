/**
 * SpaceView.js - 宇宙视角模块
 * 用于3D地球-太阳教学工具，展示地球公转、自转、地轴倾斜等天文现象
 */

import * as THREE from 'three';
import { degToRad, radToDeg, getSolarDeclination, getEarthOrbitalAngle, getSolarPosition } from './GeoMath.js';

// 地轴倾斜角（23.44°转换为弧度）
const AXIAL_TILT = degToRad(23.44);
// 公转轨道半径
const ORBIT_RADIUS = 15;
// 地球半径
const EARTH_RADIUS = 1;
// 太阳半径
const SUN_RADIUS = 3;

export class SpaceView {
  constructor(scene) {
    // 创建主场景组
    this.group = new THREE.Group();
    scene.add(this.group);

    // 标签数组，用于控制显示/隐藏
    this.labels = [];
    // 辅助线数组，用于控制显示/隐藏
    this.helpers = [];
    this.surfaceHelpers = [];
    this.surfaceTrajectory = [];
    this.lastSurfaceParams = {};

    // 初始化各个组件
    this._createSun();
    this._createEarth();
    this._createOrbit();
    this._createHelpers();
    this._createDirectRay();
    this._createLocalCompass();
  }

  /**
   * 创建太阳
   * 包括太阳球体、光晕效果和点光源
   */
  _createSun() {
    // 太阳球体
    const sunGeo = new THREE.SphereGeometry(SUN_RADIUS, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffdd44 });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    this.sunMesh.position.set(0, 0, 0);
    this.group.add(this.sunMesh);

    // 太阳光晕效果 - 使用Canvas绘制径向渐变
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 128;
    glowCanvas.height = 128;
    const ctx = glowCanvas.getContext('2d');

    // 绘制从中心亮黄色到透明的径向渐变
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 255, 200, 1.0)');
    gradient.addColorStop(0.3, 'rgba(255, 230, 100, 0.6)');
    gradient.addColorStop(0.7, 'rgba(255, 200, 50, 0.2)');
    gradient.addColorStop(1, 'rgba(255, 200, 50, 0.0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTexture,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.sunGlowSprite = new THREE.Sprite(glowMat);
    this.sunGlowSprite.scale.set(20, 20, 1);
    this.group.add(this.sunGlowSprite);

    // 点光源 - 模拟太阳光照
    const sunLight = new THREE.PointLight(0xfff5e0, 2, 100);
    sunLight.position.set(0, 0, 0);
    this.group.add(sunLight);
  }

  /**
   * 创建地球
   * 包括地球球体、大气层光晕、地轴线和纬线圈
   */
  _createEarth() {
    // 地球公转位置组（在轨道上移动）
    this.earthGroup = new THREE.Group();

    // 地球倾斜组（模拟地轴倾斜）
    this.earthTiltGroup = new THREE.Group();
    this.earthGroup.add(this.earthTiltGroup);

    // 地球球体 (使用自定义着色器区分昼夜半球)
    const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS, 32, 32);
    const earthMat = new THREE.ShaderMaterial({
      uniforms: {
        sunPosition: { value: new THREE.Vector3(0, 0, 0) },
      },
      vertexShader: `
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          // 将法线转换到世界空间
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 sunPosition;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;
        void main() {
          vec3 lightDir = normalize(sunPosition - vWorldPosition);
          float intensity = dot(normalize(vWorldNormal), lightDir);
          
          vec3 nightColor = vec3(0.05, 0.1, 0.25);
          vec3 dayColor = vec3(0.15, 0.5, 0.9);
          
          // 太阳直射点的亮斑
          vec3 sunTint = vec3(1.0, 0.9, 0.7) * pow(max(0.0, intensity), 2.0) * 0.5;
          
          float mixValue = smoothstep(-0.05, 0.05, intensity);
          vec3 finalColor = mix(nightColor, dayColor + sunTint, mixValue);
          
          // 晨昏线（黄昏/黎明的一丝橙色）
          float twilight = smoothstep(0.0, 1.0, 1.0 - abs(intensity * 10.0));
          if (intensity > -0.1 && intensity < 0.1) {
              finalColor = mix(finalColor, vec3(0.8, 0.4, 0.1), twilight * 0.5);
          }
          
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `
    });
    this.earthMesh = new THREE.Mesh(earthGeo, earthMat);
    this.earthTiltGroup.add(this.earthMesh);

    // 添加观察者标记组 (在地球表面)
    this.observerMarker = new THREE.Group();
    
    // 预先创建标记用的几何体和材质，避免在动画循环中重复创建造成内存泄漏
    this.markerAssets = {
      dotGeoLarge: new THREE.SphereGeometry(0.05, 16, 16),
      dotGeoSmall: new THREE.SphereGeometry(0.03, 16, 16),
      pinGeoLarge: new THREE.CylinderGeometry(0.01, 0.01, 0.2),
      pinGeoSmall: new THREE.CylinderGeometry(0.01, 0.01, 0.15),
      matRed: new THREE.MeshBasicMaterial({ color: 0xff3333 }),
      matYellow: new THREE.MeshBasicMaterial({ color: 0xffd700 }),
      matWhite: new THREE.MeshBasicMaterial({ color: 0xffffff })
    };
    
    this.earthMesh.add(this.observerMarker);
    this.earthTiltGroup.add(this.earthMesh);

    // 大气层光晕 - 使用Fresnel边缘发光着色器
    const atmosphereGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.05, 32, 32);
    const atmosphereMat = new THREE.ShaderMaterial({
      vertexShader: `
        // 大气层顶点着色器
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPosition = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        // 大气层片段着色器 - Fresnel边缘发光
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        void main() {
          vec3 viewDir = normalize(vViewPosition);
          // 计算Fresnel效果强度
          float intensity = pow(1.0 - abs(dot(vNormal, viewDir)), 2.5);
          // 输出淡蓝色大气光晕
          gl_FragColor = vec4(0.4, 0.7, 1.0, intensity * 0.5);
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    this.atmosphereMesh = new THREE.Mesh(atmosphereGeo, atmosphereMat);
    this.earthTiltGroup.add(this.atmosphereMesh);

    // 地轴线 - 红色线段表示地轴方向
    const axisPoints = [
      new THREE.Vector3(0, -1.8, 0),
      new THREE.Vector3(0, 1.8, 0),
    ];
    const axisGeo = new THREE.BufferGeometry().setFromPoints(axisPoints);
    const axisMat = new THREE.LineBasicMaterial({ color: 0xff4444 });
    const axisLine = new THREE.Line(axisGeo, axisMat);
    this.earthTiltGroup.add(axisLine);
    this.helpers.push(axisLine);

    // 应用地轴倾斜
    this.earthTiltGroup.rotation.x = AXIAL_TILT;

    // 将地球组添加到主组
    this.group.add(this.earthGroup);

    // 创建纬线圈（赤道、回归线、极圈）
    this._createLatitudeCircles();
  }

  /**
   * 创建经纬线圈
   * 赤道(0°)、南北回归线(±23.44°)、南北极圈(±66.56°) 以及每30度的经线
   */
  _createLatitudeCircles() {
    const latitudes = [
      { deg: 0, name: '赤道', color: 0xffffff },           // 赤道 - 白色
      { deg: 23.44, name: '北回归线', color: 0xff9800 },    // 北回归线 - 橙色
      { deg: -23.44, name: '南回归线', color: 0xff9800 },   // 南回归线 - 橙色
      { deg: 66.56, name: '北极圈', color: 0x00bcd4 },     // 北极圈 - 青色
      { deg: -66.56, name: '南极圈', color: 0x00bcd4 },    // 南极圈 - 青色
    ];

    const segments = 64;
    const R = EARTH_RADIUS;

    latitudes.forEach(({ deg, color }) => {
      const lat = degToRad(deg);
      const points = [];

      // 沿纬线生成64个点
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const x = Math.cos(lat) * Math.cos(theta) * R;
        const y = Math.sin(lat) * R;
        const z = Math.cos(lat) * Math.sin(theta) * R;
        points.push(new THREE.Vector3(x, y, z));
      }

      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.6,
      });
      const line = new THREE.Line(lineGeo, lineMat);

      // 添加为地球网格的子对象
      this.earthTiltGroup.add(line);
      this.helpers.push(line);
    });

    // 创建经线圈 (每30度一条，共12个半圆或6个全圆)
    for (let i = 0; i < 6; i++) {
      const lngRad = (i * 30 * Math.PI) / 180;
      const points = [];
      const segments = 64;
      for (let j = 0; j <= segments; j++) {
        const theta = (j / segments) * Math.PI * 2;
        const x = EARTH_RADIUS * 1.002 * Math.cos(theta) * Math.sin(lngRad);
        const y = EARTH_RADIUS * 1.002 * Math.sin(theta);
        const z = EARTH_RADIUS * 1.002 * Math.cos(theta) * Math.cos(lngRad);
        points.push(new THREE.Vector3(x, y, z));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      
      // 本初子午线(0度)加粗和换颜色
      const isPrime = i === 0;
      const mat = new THREE.LineBasicMaterial({
        color: isPrime ? 0x00ff00 : 0xffffff,
        transparent: true,
        opacity: isPrime ? 0.3 : 0.1,
      });
      const line = new THREE.Line(geo, mat);
      this.earthMesh.add(line); // 注意，经线加在earthMesh上，随地球自转！
      this.helpers.push(line);
    }
  }

  /**
   * 创建公转轨道
   * 包括轨道路径和四个节气标记点
   */
  _createOrbit() {
    // 轨道路径 - 在XZ平面上的圆形
    const orbitPoints = [];
    const segments = 128;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = ORBIT_RADIUS * Math.cos(angle);
      const z = -ORBIT_RADIUS * Math.sin(angle);
      orbitPoints.push(new THREE.Vector3(x, 0, z));
    }

    const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPoints);
    const orbitMat = new THREE.LineDashedMaterial({
      color: 0x4fc3f7,
      opacity: 0.3,
      transparent: true,
      dashSize: 0.5,
      gapSize: 0.3,
    });
    const orbitLine = new THREE.Line(orbitGeo, orbitMat);
    // 计算线段距离以使虚线生效
    orbitLine.computeLineDistances();
    this.group.add(orbitLine);
    this.helpers.push(orbitLine);

    // 节气标记 - 春分、夏至、秋分、冬至
    const seasonMarkers = [
      { angle: 0, label: '春分 3/21', color: 0x4caf50 },                     // 春分
      { angle: Math.PI / 2, label: '夏至 6/22', color: 0xff9800 },           // 夏至
      { angle: Math.PI, label: '秋分 9/23', color: 0xff5722 },               // 秋分
      { angle: (3 * Math.PI) / 2, label: '冬至 12/22', color: 0x2196f3 },    // 冬至
    ];

    seasonMarkers.forEach(({ angle, label, color }) => {
      // 节气标记球体
      const markerGeo = new THREE.SphereGeometry(0.2, 16, 16);
      const markerMat = new THREE.MeshBasicMaterial({ color: color });
      const marker = new THREE.Mesh(markerGeo, markerMat);

      const x = ORBIT_RADIUS * Math.cos(angle);
      const z = -ORBIT_RADIUS * Math.sin(angle);
      marker.position.set(x, 0, z);
      this.group.add(marker);
      this.helpers.push(marker);

      // 节气文字标签
      const labelSprite = this._createTextSprite(label, '#ffffff', 48);
      labelSprite.position.set(x, 1.5, z);
      this.group.add(labelSprite);
      this.labels.push(labelSprite);
    });
  }

  /**
   * 创建辅助显示元素
   * 黄道面指示器（半透明圆环）
   */
  _createHelpers() {
    // 黄道面指示器 - 半透明圆环显示轨道平面
    const eclipticGeo = new THREE.RingGeometry(3.5, ORBIT_RADIUS + 1, 64);
    const eclipticMat = new THREE.MeshBasicMaterial({
      color: 0x4fc3f7,
      opacity: 0.03,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const eclipticPlane = new THREE.Mesh(eclipticGeo, eclipticMat);

    // RingGeometry默认在XY平面，旋转到XZ平面
    eclipticPlane.rotation.x = -Math.PI / 2;
    eclipticPlane.position.y = 0;
    this.group.add(eclipticPlane);
    this.helpers.push(eclipticPlane);
  }

  /**
   * 创建太阳直射光线
   * 从太阳中心指向地球的黄色射线，带箭头
   */
  _createDirectRay() {
    // 直射光线 - 从太阳到地球的连线
    const rayPoints = [
      new THREE.Vector3(0, 0, 0),       // 太阳位置
      new THREE.Vector3(ORBIT_RADIUS, 0, 0),  // 地球位置（初始值，会在update中更新）
    ];
    const rayGeo = new THREE.BufferGeometry().setFromPoints(rayPoints);
    const rayMat = new THREE.LineBasicMaterial({
      color: 0xffdd44,
      linewidth: 2,
    });
    this.directRay = new THREE.Line(rayGeo, rayMat);
    this.group.add(this.directRay);

    // 箭头（锥体）- 指向地球方向
    const coneGeo = new THREE.ConeGeometry(0.15, 0.5, 8);
    const coneMat = new THREE.MeshBasicMaterial({ color: 0xffdd44 });
    this.rayCone = new THREE.Mesh(coneGeo, coneMat);
    this.group.add(this.rayCone);
  }

  /**
   * 创建实地视角的本地指南针/地平圆盘
   */
  _createLocalCompass() {
    this.localCompassGroup = new THREE.Group();
    this.localCompassGroup.visible = false;
    this.earthMesh.add(this.localCompassGroup);


    // 巨大、无限延伸的切平面（虚拟大地）
    const groundGeo = new THREE.CircleGeometry(500, 64);
    const groundMat = new THREE.MeshBasicMaterial({ color: 0x111118, side: THREE.DoubleSide, depthTest: true });
    this.groundMat = groundMat;
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.position.z = -0.05;
    this.localCompassGroup.add(groundMesh);

    // 大地网格
    const gridHelper = new THREE.GridHelper(1000, 200, 0x222233, 0x1a1a22);
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.z = -0.0495;
    this.localCompassGroup.add(gridHelper);

    // 半透明的绿色地平圆盘

    const diskGeo = new THREE.CircleGeometry(0.04, 32);
    const diskMat = new THREE.MeshBasicMaterial({ color: 0x228822, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthTest: false });
    const disk = new THREE.Mesh(diskGeo, diskMat);
    // CircleGeometry默认面向+Z，将其翻转以便+Z对准天顶
    disk.rotation.x = 0;
    disk.position.z = -0.049;
    this.localCompassGroup.add(disk);

    // 十字方向线
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false });
    const crossGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.04, 0, 0), new THREE.Vector3(0.04, 0, 0),
      new THREE.Vector3(0, -0.04, 0), new THREE.Vector3(0, 0.04, 0)
    ]);
    const cross = new THREE.LineSegments(crossGeo, lineMat);
    cross.position.z = -0.048;
    this.localCompassGroup.add(cross);

    
    
    // 天顶线 (垂直于地面的线)
    const zenithGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0.5)
    ]);
    const zenithLine = new THREE.Line(zenithGeo, new THREE.LineBasicMaterial({ color: 0x8888ff, depthTest: false }));
    this.localCompassGroup.add(zenithLine);
    this._createSurfaceHelpers();
  }


  /** 创建实地视角的辅助网格 */
  _createSurfaceHelpers() {
    this.surfaceGridGroup = new THREE.Group();
    this.surfaceGridGroup.visible = false;
    this.localCompassGroup.add(this.surfaceGridGroup);

    const helperMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 });
    const SKY_RADIUS = 50;

    // 30° 和 60° 高度圈
    const altitudes = [30, 60];
    for (const altDeg of altitudes) {
      const altRad = degToRad(altDeg);
      const points = [];
      for (let i = 0; i <= 128; i++) {
        const theta = (i / 128) * Math.PI * 2;
        // Horizon View: y=sin(alt), z=-cos(alt)*cos(theta), x=cos(alt)*sin(theta)
        // Compass View: Z=Zenith(y), Y=North(-z), X=East(x)
        const x = SKY_RADIUS * Math.cos(altRad) * Math.sin(theta);
        const y = SKY_RADIUS * Math.cos(altRad) * Math.cos(theta); // North is -z in Horizon -> Y in Compass
        const z = SKY_RADIUS * Math.sin(altRad);
        points.push(new THREE.Vector3(x, y, z));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geo, helperMat.clone());
      this.surfaceGridGroup.add(line);
      this.surfaceHelpers.push(line);
    }

    // 子午线弧 (从北经天顶到南)
    const meridianPoints = [];
    for (let i = 0; i <= 64; i++) {
      const angle = (i / 64) * Math.PI; // 0 to PI
      const x = 0;
      const y = SKY_RADIUS * Math.cos(angle); // North is Y
      const z = SKY_RADIUS * Math.sin(angle); // Zenith is Z
      meridianPoints.push(new THREE.Vector3(x, y, z));
    }
    const meridianGeo = new THREE.BufferGeometry().setFromPoints(meridianPoints);
    const meridianLine = new THREE.Line(meridianGeo, helperMat.clone());
    this.surfaceGridGroup.add(meridianLine);
    // 天际线方位标签 (东南西北)
    const createSkyLabel = (text, x, y) => {
      const sprite = this._createTextSprite(text, '#ffffff', 64);
      sprite.position.set(x, y, 0.2); // 略高于地平线
      sprite.scale.set(24, 6, 6); // 保持画布的4:1横纵比
      return sprite;
    };
    this.surfaceGridGroup.add(createSkyLabel('北', 0, SKY_RADIUS));
    this.surfaceGridGroup.add(createSkyLabel('南', 0, -SKY_RADIUS));
    this.surfaceGridGroup.add(createSkyLabel('东', SKY_RADIUS, 0));
    this.surfaceGridGroup.add(createSkyLabel('西', -SKY_RADIUS, 0));

    this.surfaceHelpers.push(meridianLine);


    // 太阳轨迹组
    // 实地视角专用虚拟数学太阳
    const fakeSunGeo = new THREE.SphereGeometry(0.3, 32, 32);
    const fakeSunMat = new THREE.MeshBasicMaterial({ color: 0xffdd44 });
    this.surfaceFakeSun = new THREE.Mesh(fakeSunGeo, fakeSunMat);
    this.surfaceFakeSun.visible = false;
    this.localCompassGroup.add(this.surfaceFakeSun);
    
    this.surfaceTrajectoryGroup = new THREE.Group();
    this.surfaceTrajectoryGroup.visible = false;
    this.localCompassGroup.add(this.surfaceTrajectoryGroup);

    
  }


  /** 更新实地视角的太阳轨迹 */
  _updateSurfaceSolarTrajectory(latitudeDeg, longitudeDeg, dayOfYear) {
    if (this.lastSurfaceParams.lat === latitudeDeg && this.lastSurfaceParams.lng === longitudeDeg && this.lastSurfaceParams.day === dayOfYear) return;
    this.lastSurfaceParams = { lat: latitudeDeg, lng: longitudeDeg, day: dayOfYear };

    // 清除旧轨迹
    for (const obj of this.surfaceTrajectory) {
      this.surfaceTrajectoryGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
    this.surfaceTrajectory = [];

    const points = [];
    const dist = 15; // 真实太阳距离
    
    // 基于严格天文公式计算视轨迹
    for (let h = 0; h <= 24.1; h += 0.25) {
      const pos = getSolarPosition(latitudeDeg, dayOfYear, h);
      const alt = pos.altitude;
      const az = pos.azimuth;
      
      // X=东, Y=北, Z=天顶
      const x = dist * Math.cos(alt) * Math.sin(az);
      const y = dist * Math.cos(alt) * Math.cos(az);
      const z = dist * Math.sin(alt);
      
      points.push(new THREE.Vector3(x, y, z));
    }

    if (points.length > 1) {
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({ color: 0xff9800, transparent: true, opacity: 0.6, linewidth: 2 });
      const line = new THREE.Line(geo, mat);
      this.surfaceTrajectoryGroup.add(line);
      this.surfaceTrajectory.push(line);
    }
  }



  /**
   * 创建文字精灵
   * @param {string} text - 要显示的文字
   * @param {string} color - 文字颜色（CSS格式）
   * @param {number} fontSize - 字体大小
   * @returns {THREE.Sprite} 文字精灵对象
   */
  _createTextSprite(text, color = '#ffffff', fontSize = 48) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // 透明背景
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 设置字体样式
    ctx.font = `bold ${fontSize}px Inter, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 在画布中心绘制文字
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    // 创建纹理和精灵材质
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(spriteMat);

    // 设置精灵缩放比例
    sprite.scale.set(3, 0.75, 1);

    return sprite;
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  _updateLocationMarkers(locations) {
    if (!this.locationMarkersGroup) {
      this.locationMarkersGroup = new THREE.Group();
      this.earthMesh.add(this.locationMarkersGroup);
      this.locationMarkers = [];
    }

    const currentIds = this.locationMarkers.map(m => m.userData.id).join(',');
    const newIds = locations.map(l => l.id).join(',');
    
    if (currentIds !== newIds) {
      // Clear old
      this.locationMarkers.forEach(m => {
        this.locationMarkersGroup.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      });
      this.locationMarkers = [];
      
      // Create new
      locations.forEach(loc => {
        const pinGeo = new THREE.SphereGeometry(0.02, 16, 16);
        const pinMat = new THREE.MeshBasicMaterial({ color: 0x4488ff });
        const pin = new THREE.Mesh(pinGeo, pinMat);
        
        const latR = loc.lat * Math.PI / 180;
        const lngR = loc.lng * Math.PI / 180;
        const radius = 1.02; // slightly above surface
        
        const x = radius * Math.cos(latR) * Math.sin(lngR);
        const y = radius * Math.sin(latR);
        const z = radius * Math.cos(latR) * Math.cos(lngR);
        
        pin.position.set(x, y, z);
        pin.userData = { id: loc.id, color: loc.color };
        
        this.locationMarkersGroup.add(pin);
        this.locationMarkers.push(pin);
      });
    }
  }

  /**
   * 更新模型状态
   * @param {number} dayOfYear - 一年中的天数 (1-366)
   * @param {number} timeOfDay - 一天中的时间 (0-24小时，代表观察者本地太阳时)
   * @param {boolean} showHelpers - 是否显示辅助线
   * @param {boolean} showLabels - 是否显示标签文字
   * @param {number} latitudeDeg - 观察者纬度 (度)
   * @param {number} longitudeDeg - 观察者经度 (度)
   * @param {Array} locations - 保存的地点列表
   * @param {string} activeLocationId - 当前激活的地点ID
   * @param {boolean} isSurfaceView - 是否为实地视角
   */
  update(dayOfYear, timeOfDay, showHelpers, showLabels, latitudeDeg, longitudeDeg, locations = [], activeLocationId = null, isSurfaceView = false) {
    this._updateLocationMarkers(locations);
    
    // 计算地球公转角度
    const orbitalAngle = getEarthOrbitalAngle(dayOfYear);

    // 计算地球在轨道上的位置
    // 当轨道角为0(春分)时，地球在+X轴；90度(夏至)时，在-Z轴
    const earthX = 15 * Math.cos(orbitalAngle); // ORBIT_RADIUS = 15
    const earthZ = -15 * Math.sin(orbitalAngle);
    this.earthGroup.position.set(earthX, 0, earthZ);

    this.earthTiltGroup.rotation.x = 23.44 * Math.PI / 180; // AXIAL_TILT

    const currentLngRad = longitudeDeg * Math.PI / 180;
    // 使用赤经(Right Ascension)投影替代直接的黄经，消除因黄赤交角导致的真太阳时偏差(时间均差的倾角部分)，使标记点严格对齐太阳
    const projectedOrbitalAngle = Math.atan2(Math.sin(orbitalAngle) * Math.cos(23.44 * Math.PI / 180), Math.cos(orbitalAngle));
    this.earthMesh.rotation.y = (timeOfDay / 24) * Math.PI * 2 - currentLngRad + Math.PI / 2 + projectedOrbitalAngle;

    // 更新辅助线和标签 (实地视角下隐藏宇宙级别的辅助线和标签)
    const showSpaceHelpers = isSurfaceView ? false : showHelpers;
    const showSpaceLabels = isSurfaceView ? false : showLabels;

    if (this.helpers) {
      this.helpers.forEach(helper => {
        helper.visible = showSpaceHelpers;
      });
    }

    if (this.labels) {
      this.labels.forEach(label => {
        label.visible = showSpaceLabels;
      });
    }
    
    // 更新地点标记 (实地视角下隐藏其他地点的红头针)
    if (this.locationMarkers) {
      this.locationMarkers.forEach(marker => {
        marker.visible = !isSurfaceView;
        const isActive = marker.userData.id === activeLocationId;
        marker.material.color.set(marker.userData.color);
        marker.scale.setScalar(isActive ? 1.5 : 1.0);
        // 如果当前是活动的点，确保它在最前面显示
        marker.renderOrder = isActive ? 999 : 1;
      });
    }
    
    // 更新直射光线指示器：两个端点实时跟随地球当前位置
    if (this.directRay) {
      this.directRay.visible = showSpaceHelpers;
      // 更新线段两个端点：起点=太阳中心(0,0,0)，终点=地球当前位置
      const positions = this.directRay.geometry.attributes.position;
      positions.setXYZ(0, 0, 0, 0);
      positions.setXYZ(1, earthX, 0, earthZ);
      positions.needsUpdate = true;
      this.directRay.geometry.computeBoundingSphere();
    }
    if (this.rayCone) {
      this.rayCone.visible = showSpaceHelpers;
      // 箭头放在地球一侧，指向地球方向
      this.rayCone.position.set(earthX * 0.85, 0, earthZ * 0.85);
      // 箭头朝向地球（默认Y轴方向旋转到周向量方向）
      const dir = new THREE.Vector3(earthX, 0, earthZ).normalize();
      this.rayCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    }

    // 实地视角下更新本地指南针
    if (this.localCompassGroup) {
      if (isSurfaceView) {
        if (this.surfaceFakeSun) {
          const pos = getSolarPosition(latitudeDeg, dayOfYear, timeOfDay);
          const alt = pos.altitude;
          const az = pos.azimuth;
          const dist = 15;
          this.surfaceFakeSun.position.set(
            dist * Math.cos(alt) * Math.sin(az),
            dist * Math.cos(alt) * Math.cos(az),
            dist * Math.sin(alt)
          );
          this.surfaceFakeSun.visible = true;
        }
        this.localCompassGroup.visible = true;
        if (this.surfaceGridGroup) this.surfaceGridGroup.visible = showHelpers;
        if (this.surfaceTrajectoryGroup) {
          this.surfaceTrajectoryGroup.visible = showHelpers;
          if (showHelpers) {
            this._updateSurfaceSolarTrajectory(latitudeDeg, longitudeDeg, dayOfYear);
          }
        }
        if (this.atmosphereMesh) this.atmosphereMesh.visible = false;
        
        const latR = latitudeDeg * Math.PI / 180;
        const lngR = longitudeDeg * Math.PI / 180;
        // 将指南针放在略高于地表的位置
        const radius = 1.001; // EARTH_RADIUS * 1.001
        const localPos = new THREE.Vector3(
          radius * Math.cos(latR) * Math.sin(lngR),
          radius * Math.sin(latR),
          radius * Math.cos(latR) * Math.cos(lngR)
        );
        this.localCompassGroup.position.copy(localPos);

        // 计算局部坐标系
        const zenith = localPos.clone().normalize();
        const pole = new THREE.Vector3(0, 1, 0); // 极轴
        let north = new THREE.Vector3().subVectors(pole, zenith.clone().multiplyScalar(pole.dot(zenith)));
        if (north.lengthSq() < 0.0001) north.set(0, 0, -1);
        north.normalize();
        const east = new THREE.Vector3().crossVectors(north, zenith).normalize();
        const south = north.clone().negate();

        // 构造旋转矩阵：圆盘在XY平面，法线是+Z。
        // 希望圆盘的+X指向东(east)，+Y指向北(north)，+Z指向天顶(zenith)
        const basis = new THREE.Matrix4().makeBasis(east, north, zenith);
        this.localCompassGroup.quaternion.setFromRotationMatrix(basis);

        // 动态调整地面颜色以模拟光照
        if (this.groundMat) {
          const sunWorld = new THREE.Vector3(0, 0, 0);
          const sunLocal = sunWorld.clone();
          this.localCompassGroup.worldToLocal(sunLocal);
          const sunAlt = sunLocal.normalize().z;
          
          const colorStops = [
            { alt: 1.0, color: new THREE.Color(0x5a9ad0) }, // 正午：明亮的蔚蓝
            { alt: 0.5, color: new THREE.Color(0x4a7aa0) }, // 下午：柔和的蓝色
            { alt: 0.2, color: new THREE.Color(0x3a5a80) }, // 傍晚：深蓝色
            { alt: 0.05, color: new THREE.Color(0x9a5a30) }, // 日落前：暖橙色
            { alt: 0.0, color: new THREE.Color(0xd95a20) }, // 日落/日出：耀眼的火橙色
            { alt: -0.05, color: new THREE.Color(0x2a1a3a) }, // 暮光：暗紫色
            { alt: -0.2, color: new THREE.Color(0x111118) }, // 夜晚：深沉黑
            { alt: -1.0, color: new THREE.Color(0x050508) }  // 午夜：极暗
          ];
          
          const targetColor = new THREE.Color();
          if (sunAlt >= colorStops[0].alt) {
            targetColor.copy(colorStops[0].color);
          } else if (sunAlt <= colorStops[colorStops.length - 1].alt) {
            targetColor.copy(colorStops[colorStops.length - 1].color);
          } else {
            for (let i = 0; i < colorStops.length - 1; i++) {
              if (sunAlt <= colorStops[i].alt && sunAlt > colorStops[i+1].alt) {
                const t = (sunAlt - colorStops[i+1].alt) / (colorStops[i].alt - colorStops[i+1].alt);
                targetColor.copy(colorStops[i+1].color).lerp(colorStops[i].color, t);
                break;
              }
            }
          }
          this.groundMat.color.copy(targetColor);
        }
      } else {
        if (this.surfaceFakeSun) this.surfaceFakeSun.visible = false;
        this.localCompassGroup.visible = false;
        if (this.atmosphereMesh) this.atmosphereMesh.visible = true;
      }
    }
  }
}
