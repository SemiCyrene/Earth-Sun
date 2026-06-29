/**
 * SceneManager.js - Three.js 场景管理核心
 * 负责场景初始化、渲染循环、相机控制和视角切换
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SpaceView } from './SpaceView.js';
import { HorizonView } from './HorizonView.js';

export class SceneManager {
  /**
   * @param {HTMLElement} container - 用于放置 Canvas 的 DOM 容器
   */
  constructor(container) {
    this.container = container;
    this.currentView = 'space'; // 'space' | 'horizon'

    // === 初始化 Three.js 核心组件 ===
    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initControls();
    this._initLights();
    this._createStarfield();

    // === 初始化两个视角模块 ===
    this.spaceView = new SpaceView(this.scene);
    this.horizonView = new HorizonView(this.scene);

    // 默认显示宇宙视角
    this.spaceView.setVisible(true);
    this.horizonView.setVisible(false);

    // === 交互 (点击地点) ===
    this._initInteraction();

    // === 窗口大小变化监听 ===
    window.addEventListener('resize', () => this._onResize());

    // === 启动渲染循环 ===
    this._animate();
  }

  /** 初始化 WebGL 渲染器 */
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x050510, 1);
    this.renderer.shadowMap.enabled = false;
    this.container.appendChild(this.renderer.domElement);
  }

  /** 初始化场景 */
  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = null; // 太空场景不需要雾效果
  }

  /** 初始化相机 */
  _initCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.01, 1000);
    // 宇宙视角的默认相机位置
    this._setSpaceCameraPosition();
  }

  /** 设置宇宙视角的相机位置 */
  _setSpaceCameraPosition() {
    this.camera.position.set(20, 18, 25);
    this.camera.lookAt(0, 0, 0);
  }

  /** 设置地平视角的相机位置 */
  _setHorizonCameraPosition() {
    this.camera.position.set(0, 8, -25);
    this.camera.lookAt(0, 10, 0);
  }

  /** 初始化轨道控制器 */
  _initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;         // 启用阻尼惯性
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = true;             // 允许平移
    this.controls.enableZoom = true;            // 允许缩放
    this.controls.minDistance = 5;
    this.controls.maxDistance = 100;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 1.2;
    this.controls.target.set(0, 0, 0);
  }

  /** 初始化环境光 */
  _initLights() {
    // 微弱的环境光，让背面不完全漆黑
    const ambientLight = new THREE.AmbientLight(0x222244, 0.3);
    this.scene.add(ambientLight);
  }

  /** 创建星空背景粒子系统 */
  _createStarfield() {
    const starsGeo = new THREE.BufferGeometry();
    const starsCount = 2000;
    const posArray = new Float32Array(starsCount * 3);
    for (let i = 0; i < starsCount * 3; i++) {
      posArray[i] = (Math.random() - 0.5) * 500;
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const starsMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.5,
      transparent: true,
      opacity: 0.8,
    });
    this.starfield = new THREE.Points(starsGeo, starsMat);
    this.scene.add(this.starfield);
  }

  /** 初始化交互 (点击和拖拽) */
  _initInteraction() {
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.pointerDownPos = new THREE.Vector2();
    this.onLocationMarkerClicked = null; // 由外部提供回调函数
    this.onObjectDragged = null; // (targetType, dx, dy) => {} 回调

    this.isDragging = false;
    this.dragTarget = null; // 'sun' | 'earth' | 'surfacePan' | null
    this.lastPointerPos = new THREE.Vector2();
    this.surfaceYaw = 0;
    this.surfacePitch = 0.2;

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      this.pointerDownPos.set(e.clientX, e.clientY);
      this.lastPointerPos.set(e.clientX, e.clientY);

      if (this.currentView === 'surface') {
        this.isDragging = true;
        this.dragTarget = 'surfacePan';
        return;
      }

      // 归一化设备坐标
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);

      // 检测是否按下了地球(宇宙视角)或太阳(地平视角)
      if (this.currentView === 'space' && this.spaceView && this.spaceView.earthMesh) {
        const intersects = this.raycaster.intersectObject(this.spaceView.earthMesh, false);
        if (intersects.length > 0) {
          this.isDragging = true;
          this.dragTarget = 'earth';
          this.controls.enabled = false;
          return;
        }
      } else if (this.currentView === 'horizon' && this.horizonView && this.horizonView.sun) {
        const intersects = this.raycaster.intersectObject(this.horizonView.sun);
        if (intersects.length > 0) {
          this.isDragging = true;
          this.dragTarget = 'sun';
          this.controls.enabled = false;
          return;
        }
      }
    });

    this.renderer.domElement.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;

      const dx = e.clientX - this.lastPointerPos.x;
      const dy = e.clientY - this.lastPointerPos.y;
      this.lastPointerPos.set(e.clientX, e.clientY);

      if (this.dragTarget === 'surfacePan') {
        this.surfaceYaw -= dx * 0.005;
        this.surfacePitch += dy * 0.005;
        // 限制仰俯角 (允许向上看几乎垂直，向下看大概30度即0.5弧度左右)
        this.surfacePitch = Math.max(-Math.PI / 2 + 0.01, Math.min(0.5, this.surfacePitch));
        return;
      }

      let logicalDx = dx;

      if (this.dragTarget === 'earth' && this.spaceView) {
        // 获取地球位置并计算轨道切线方向 (公转方向)
        const earthPos = this.spaceView.earthGroup.position;
        // P = (x, 0, z), 逆时针公转的切线 T = (z, 0, -x)
        const T = new THREE.Vector3(earthPos.z, 0, -earthPos.x).normalize();
        
        // 获取相机的 Right (X) 和 Up (Y) 向量
        const R_cam = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        const U_cam = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
        
        // 将鼠标在屏幕上的移动 (dx, -dy) 投影到轨道的屏幕切线方向上
        // 这意味着无论相机在地球内侧、外侧、甚至上下方，拖拽的方向始终符合直觉
        logicalDx = dx * R_cam.dot(T) - dy * U_cam.dot(T);
      }

      if (this.onObjectDragged) {
        this.onObjectDragged(this.dragTarget, logicalDx, dy);
      }
    });

    const endDrag = (e) => {
      if (this.isDragging) {
        this.isDragging = false;
        this.dragTarget = null;
        if (this.currentView !== 'surface') {
          this.controls.enabled = true;
        }
      }
    };

    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  }

  /**
   * 切换视角模式
   * @param {'space' | 'earth' | 'horizon'} viewName - 视角名称
   */
  switchView(viewName) {
    if (viewName === this.currentView) return;

    this.currentView = viewName;

    if (viewName === 'space' || viewName === 'earth' || viewName === 'surface') {
      this.spaceView.setVisible(true);
      this.horizonView.setVisible(false);
      
      if (viewName === 'space') {
        this.controls.enabled = true;
        this.camera.up.set(0, 1, 0); // 恢复相机默认朝向
        this._setSpaceCameraPosition();
        this.controls.target.set(0, 0, 0);
        this.controls.minDistance = 5;
        this.controls.maxDistance = 100;
      } else if (viewName === 'earth') {
        this.controls.enabled = true;
        this.camera.up.set(0, 1, 0); // 恢复相机默认朝向
        this.controls.minDistance = 2;
        this.controls.maxDistance = 50;
        if (this.spaceView.earthGroup) {
          const earthPos = this.spaceView.earthGroup.position;
          this.controls.target.copy(earthPos);
          
          // 初始放在地球旁边，相对于地球和太阳的连线保持固定的初始角度
          const currentAngle = Math.atan2(-earthPos.z, earthPos.x);
          const offset = new THREE.Vector3(5, 2, 5);
          offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), currentAngle);
          this.camera.position.copy(earthPos).add(offset);
          
          this.lastEarthAngle = currentAngle;
        }
      } else if (viewName === 'surface') {
        this.controls.enabled = false;
        // 位置会在 updateView 里面基于经纬度和自转每帧更新
        this.surfaceYaw = 0; 
        this.surfacePitch = 0.2; 
      }
    } else {
      this.camera.up.set(0, 1, 0); // 恢复相机默认朝向
      this.spaceView.setVisible(false);
      this.horizonView.setVisible(true);
      this.controls.enabled = true;
      this._setHorizonCameraPosition();
      this.controls.target.set(0, 10, 0);
      this.controls.minDistance = 3;
      this.controls.maxDistance = 80;
    }

    this.controls.update();
  }

  /**
   * 重置当前视角的相机位置和目标
   */
  resetCamera() {
    if (this.currentView === 'space') {
      this.camera.up.set(0, 1, 0);
      this._setSpaceCameraPosition();
      this.controls.target.set(0, 0, 0);
    } else if (this.currentView === 'earth') {
      this.camera.up.set(0, 1, 0);
      if (this.spaceView && this.spaceView.earthGroup) {
        const earthPos = this.spaceView.earthGroup.position;
        this.controls.target.copy(earthPos);
        
        const currentAngle = Math.atan2(-earthPos.z, earthPos.x);
        const offset = new THREE.Vector3(5, 2, 5);
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), currentAngle);
        this.camera.position.copy(earthPos).add(offset);
        
        this.lastEarthAngle = currentAngle;
      }
    } else if (this.currentView === 'horizon') {
      this.camera.up.set(0, 1, 0);
      this._setHorizonCameraPosition();
      this.controls.target.set(0, 10, 0);
    } else if (this.currentView === 'surface') {
      this.camera.up.set(0, 1, 0);
      this.surfaceYaw = 0;
      this.surfacePitch = 0.2;
    }
    this.controls.update();
  }

  /**
   * 更新当前视角的状态
   * @param {object} params - 更新参数
   */
  updateView(params) {
    const { dayOfYear, timeOfDay, showHelpers, showLabels, latitudeDeg, longitudeDeg, locations, activeLocationId } = params;

    if (this.currentView === 'space' || this.currentView === 'earth' || this.currentView === 'surface') {
      const isSurfaceView = this.currentView === 'surface';
      this.lastLatitudeDeg = latitudeDeg;
      this.lastLongitudeDeg = longitudeDeg;
      this.spaceView.update(dayOfYear, timeOfDay, showHelpers, showLabels, latitudeDeg, longitudeDeg, locations, activeLocationId, isSurfaceView);
      
      // 动态调整太阳大小和光晕：实地视角下把太阳缩小，并隐藏光晕
      if (this.spaceView.earthMesh && this.spaceView.earthMesh.material) {
        this.spaceView.earthMesh.material.visible = !isSurfaceView;
      }
      if (this.spaceView.sunMesh) {
        this.spaceView.sunMesh.visible = !isSurfaceView;
        if (this.spaceView.sunGlowSprite) {
          this.spaceView.sunGlowSprite.visible = !isSurfaceView;
        }
      }
      
      if (this.currentView === 'earth' && this.spaceView.earthGroup) {
        // 相机跟随地球，并保持相对太阳的角度不变（跟随公转旋转）
        const earthPos = this.spaceView.earthGroup.position;
        const currentAngle = Math.atan2(-earthPos.z, earthPos.x);
        
        if (this.lastEarthAngle !== undefined) {
          let dAngle = currentAngle - this.lastEarthAngle;
          // 处理-PI到PI的边界反转
          if (dAngle > Math.PI) dAngle -= Math.PI * 2;
          if (dAngle < -Math.PI) dAngle += Math.PI * 2;
          
          const offset = this.camera.position.clone().sub(this.controls.target);
          offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), dAngle);
          
          this.controls.target.copy(earthPos);
          this.camera.position.copy(earthPos).add(offset);
        } else {
          this.controls.target.copy(earthPos);
        }
        this.lastEarthAngle = currentAngle;
      }
    } else {
      this.lastEarthAngle = undefined; // 离开地球视角时重置
      this.horizonView.update(latitudeDeg, dayOfYear, timeOfDay, showHelpers, showLabels);
    }
  }

  /** 每帧更新实地视角相机 */
  _updateSurfaceCamera() {
    if (this.lastLatitudeDeg === undefined || this.lastLongitudeDeg === undefined) return;
    
    const latR = this.lastLatitudeDeg * Math.PI / 180;
    const lngR = this.lastLongitudeDeg * Math.PI / 180;
    
    // 半径等于地球半径1，相机略高于地表
    const radius = 1.05;
    const localPos = new THREE.Vector3(
      radius * Math.cos(latR) * Math.sin(lngR),
      radius * Math.sin(latR),
      radius * Math.cos(latR) * Math.cos(lngR)
    );
    
    // 计算局部坐标系下的基向量 (天顶，正北，正东，正南)
    const zenith = localPos.clone().normalize();
    const pole = new THREE.Vector3(0, 1, 0);
    let north = new THREE.Vector3().subVectors(pole, zenith.clone().multiplyScalar(pole.dot(zenith)));
    if (north.lengthSq() < 0.0001) north.set(0, 0, -1);
    north.normalize();
    const east = new THREE.Vector3().crossVectors(north, zenith).normalize();
    const south = north.clone().negate();
    
    // 构造局部切面矩阵：X轴朝东，Y轴朝北，Z轴朝天顶
    const basis = new THREE.Matrix4().makeBasis(east, zenith, south);
    
    // 将用户的视角偏航和俯仰转换为观察方向向量
    const rot = new THREE.Euler(this.surfacePitch, this.surfaceYaw, 0, 'YXZ');
    const lookDir = new THREE.Vector3(0, 0, 1).applyEuler(rot).applyMatrix4(basis);
    
    // 强制更新矩阵，避免滞后1帧造成的抖动
    this.spaceView.earthMesh.updateMatrixWorld(true);
    
    // 转换到世界坐标
    const worldPos = localPos.clone();
    this.spaceView.earthMesh.localToWorld(worldPos);
    
    const worldTarget = localPos.clone().add(lookDir);
    this.spaceView.earthMesh.localToWorld(worldTarget);
    
    const worldUp = zenith.clone().transformDirection(this.spaceView.earthMesh.matrixWorld);
    
    this.camera.position.copy(worldPos);
    this.camera.up.copy(worldUp);
    this.camera.lookAt(worldTarget);
  }

  /** 渲染循环 */
  _animate() {
    requestAnimationFrame(() => this._animate());
    
    if (this.currentView === 'surface') {
      this._updateSurfaceCamera();
    } else {
      this.controls.update();
    }
    
    this.renderer.render(this.scene, this.camera);
  }

  /** 窗口大小变化处理 */
  _onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /** 销毁场景，释放资源 */
  dispose() {
    this.spaceView.dispose();
    this.horizonView.dispose();
    this.renderer.dispose();
    this.controls.dispose();
    if (this.starfield) {
      this.starfield.geometry.dispose();
      this.starfield.material.dispose();
    }
  }
}
