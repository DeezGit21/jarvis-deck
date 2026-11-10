import React, { useEffect, useRef, useState, useMemo } from 'react'
import * as THREE from 'three'

/**
 * JarvisHologramCore - Ultra high-tech Avengers / Iron Man holographic assistant neural core.
 * Fuses:
 * 1. 3D Neural Network Cortex (Brain Hemisphere Nodes, Synaptic Axon Lines, and traveling Action Potentials)
 * 2. Rotating Arc-Reactor HUD rings, radial frequency bars, and targeting reticle (from Image 2)
 * 3. Luminous spherical particle nebula with undulating brainwave ribbons (from Image 1 & 3)
 * 4. Floating Holographic Action Frames orbiting the neural core in 3D (from Image 3)
 */

// Futuristic HUD Web Audio synthesizer for Jarvis UI interaction sounds
class JarvisAudioEngine {
  constructor() {
    this.ctx = null
    this.muted = false
  }

  init() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (AudioCtx) {
        this.ctx = new AudioCtx()
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
  }

  playBeep(freq = 880, type = 'sine', duration = 0.08, gainVal = 0.06) {
    if (this.muted) return
    try {
      this.init()
      if (!this.ctx) return
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime)
      gain.gain.setValueAtTime(0.0001, this.ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(gainVal, this.ctx.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration)
      osc.connect(gain).connect(this.ctx.destination)
      osc.start()
      osc.stop(this.ctx.currentTime + duration)
    } catch (e) {}
  }

  playHudChirp(kind = 'engage') {
    if (this.muted) return
    try {
      this.init()
      if (!this.ctx) return
      const now = this.ctx.currentTime
      if (kind === 'engage') {
        [784, 1175].forEach((f, i) => {
          const osc = this.ctx.createOscillator()
          const gain = this.ctx.createGain()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(f, now + i * 0.06)
          gain.gain.setValueAtTime(0.001, now + i * 0.06)
          gain.gain.exponentialRampToValueAtTime(0.05, now + i * 0.06 + 0.015)
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.12)
          osc.connect(gain).connect(this.ctx.destination)
          osc.start(now + i * 0.06)
          osc.stop(now + i * 0.06 + 0.14)
        })
      } else if (kind === 'scan') {
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(520, now)
        osc.frequency.exponentialRampToValueAtTime(1400, now + 0.15)
        gain.gain.setValueAtTime(0.03, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18)
        osc.connect(gain).connect(this.ctx.destination)
        osc.start(now)
        osc.stop(now + 0.2)
      } else if (kind === 'synapse') {
        // High-pitched electric spark sound for synaptic firing
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(1800, now)
        osc.frequency.exponentialRampToValueAtTime(3200, now + 0.04)
        gain.gain.setValueAtTime(0.04, now)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08)
        osc.connect(gain).connect(this.ctx.destination)
        osc.start(now)
        osc.stop(now + 0.08)
      } else if (kind === 'alert') {
        [440, 440].forEach((f, i) => {
          const osc = this.ctx.createOscillator()
          const gain = this.ctx.createGain()
          osc.type = 'sawtooth'
          osc.frequency.setValueAtTime(f, now + i * 0.1)
          gain.gain.setValueAtTime(0.04, now + i * 0.1)
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.08)
          osc.connect(gain).connect(this.ctx.destination)
          osc.start(now + i * 0.1)
          osc.stop(now + i * 0.1 + 0.09)
        })
      }
    } catch (e) {}
  }
}

export const jarvisAudio = new JarvisAudioEngine()

/**
 * 3D NEURAL NETWORK BRAIN ORB
 */
export function JarvisHologramCore({
  size = 320,
  state = 'idle', // 'idle' | 'listening' | 'thinking' | 'speaking' | 'combat' | 'diagnostic'
  audioLevel = 0,
  synapticBurstTrigger = 0,
  onClick,
  accentColor = '#00f0ff',
  showHudRings = true,
  interactive = true,
  className = '',
}) {
  const mountRef = useRef(null)
  const hudCanvasRef = useRef(null)
  const isDraggingRef = useRef(false)
  const mouseRef = useRef({ x: 0, y: 0, lastX: 0, lastY: 0, rotX: 0.1, rotY: 0.2 })
  const stateRef = useRef(state)
  stateRef.current = state
  const audioLevelRef = useRef(audioLevel)
  audioLevelRef.current = audioLevel
  const accentColorRef = useRef(accentColor)
  accentColorRef.current = accentColor
  const burstRef = useRef(0)

  useEffect(() => {
    if (synapticBurstTrigger > 0) {
      burstRef.current = 1.0
      jarvisAudio.playHudChirp('synapse')
    }
  }, [synapticBurstTrigger])

  const activeColor = useMemo(() => {
    if (state === 'combat') return '#ff2a4b'
    if (state === 'diagnostic') return '#ffb800'
    return accentColor || '#00f0ff'
  }, [state, accentColor])

  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    const width = container.clientWidth || size
    const height = container.clientHeight || size

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
    camera.position.z = 5.2

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.25
    container.innerHTML = ''
    container.appendChild(renderer.domElement)

    // Master Hologram Group
    const hologramGroup = new THREE.Group()
    scene.add(hologramGroup)

    const sphereRadius = 1.65

    // Texture helper for glowing dots
    const createGlowDotTexture = (colorStr) => {
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 64
      const ctx = c.getContext('2d')
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
      g.addColorStop(0, '#ffffff')
      g.addColorStop(0.25, colorStr || '#00f0ff')
      g.addColorStop(0.65, 'rgba(0, 240, 255, 0.45)')
      g.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 64, 64)
      return new THREE.CanvasTexture(c)
    }

    // -------------------------------------------------------------------------
    // LAYER 1: 3D BRAIN HEMISPHERES & SYNAPTIC NODES
    // -------------------------------------------------------------------------
    // Generate authentic neural network nodes resembling left and right cerebral lobes
    const neuronCount = 140
    const neuronNodes = [] // { x, y, z, basePos, hemisphere, neighbors: [] }

    for (let i = 0; i < neuronCount; i++) {
      const hemisphere = i % 2 === 0 ? 1 : -1
      const u = Math.random()
      const v = Math.random()
      const theta = u * Math.PI * 0.95 + (hemisphere === 1 ? -0.1 : Math.PI - 0.1)
      const phi = Math.acos(2.0 * v - 1.0)
      
      // Slight indentation at longitudinal fissure (separation between left & right brain)
      const fissureGap = 0.88 + Math.abs(Math.sin(theta)) * 0.12
      const r = sphereRadius * fissureGap * (0.65 + Math.random() * 0.35)

      const x = r * Math.sin(phi) * Math.cos(theta) + (hemisphere * 0.08)
      const y = r * Math.sin(phi) * Math.sin(theta) * 0.92
      const z = r * Math.cos(phi) * 1.05

      const vec = new THREE.Vector3(x, y, z)
      neuronNodes.push({
        pos: vec,
        basePos: vec.clone(),
        hemisphere,
        id: i,
        neighbors: []
      })
    }

    // Connect close neurons with synaptic axon fibers
    const axonSegments = []
    const axonMaxDist = 0.72
    for (let i = 0; i < neuronNodes.length; i++) {
      for (let j = i + 1; j < neuronNodes.length; j++) {
        const d = neuronNodes[i].pos.distanceTo(neuronNodes[j].pos)
        if (d < axonMaxDist) {
          neuronNodes[i].neighbors.push(j)
          neuronNodes[j].neighbors.push(i)
          axonSegments.push(neuronNodes[i].pos)
          axonSegments.push(neuronNodes[j].pos)
        }
      }
    }

    // Axon line geometry
    const axonGeo = new THREE.BufferGeometry().setFromPoints(axonSegments)
    const axonMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(activeColor),
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
    })
    const axonLines = new THREE.LineSegments(axonGeo, axonMat)
    hologramGroup.add(axonLines)

    // Synaptic Nodes (Vertices)
    const nodeGeo = new THREE.BufferGeometry().setFromPoints(neuronNodes.map(n => n.pos))
    const nodeMat = new THREE.PointsMaterial({
      size: 0.14,
      map: createGlowDotTexture(activeColor),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const nodeCloud = new THREE.Points(nodeGeo, nodeMat)
    hologramGroup.add(nodeCloud)

    // -------------------------------------------------------------------------
    // LAYER 2: SYNAPTIC ACTION POTENTIALS (TRAVELLING ELECTRICAL SIGNALS)
    // -------------------------------------------------------------------------
    // Glowing electric signals traveling along axons between neurons
    const pulseCount = 38
    const pulses = []
    for (let i = 0; i < pulseCount; i++) {
      const startIdx = Math.floor(Math.random() * neuronNodes.length)
      const n = neuronNodes[startIdx]
      const targetIdx = n.neighbors.length > 0 ? n.neighbors[Math.floor(Math.random() * n.neighbors.length)] : startIdx
      pulses.push({
        from: startIdx,
        to: targetIdx,
        progress: Math.random(),
        speed: 0.8 + Math.random() * 1.6,
      })
    }

    const pulseGeo = new THREE.BufferGeometry()
    const pulsePositions = new Float32Array(pulseCount * 3)
    pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePositions, 3))

    const pulseMat = new THREE.PointsMaterial({
      size: 0.16,
      map: createGlowDotTexture('#ffffff'),
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const pulseCloud = new THREE.Points(pulseGeo, pulseMat)
    hologramGroup.add(pulseCloud)

    // -------------------------------------------------------------------------
    // LAYER 3: 3D Geodesic Plexus Sphere (Outer Cortex Wireframe & Facets)
    // -------------------------------------------------------------------------
    const icoGeo = new THREE.IcosahedronGeometry(sphereRadius, 2)
    const wireframeMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(activeColor),
      wireframe: true,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
    })
    const plexusMesh = new THREE.Mesh(icoGeo, wireframeMat)
    hologramGroup.add(plexusMesh)

    const facetMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(activeColor),
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const facetMesh = new THREE.Mesh(icoGeo, facetMat)
    hologramGroup.add(facetMesh)

    // Outer orbital cage ring (counter-rotating geodesic shell)
    const outerGeo = new THREE.IcosahedronGeometry(sphereRadius * 1.25, 1)
    const outerMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(activeColor),
      wireframe: true,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
    })
    const outerCage = new THREE.Mesh(outerGeo, outerMat)
    hologramGroup.add(outerCage)

    // -------------------------------------------------------------------------
    // LAYER 4: Luminous Particle Nebula with Waveform Ribbons (Images 1 & 3)
    // -------------------------------------------------------------------------
    const particleCount = 2400
    const particleGeo = new THREE.BufferGeometry()
    const pPositions = new Float32Array(particleCount * 3)
    const pBaseCoords = []
    const pColors = new Float32Array(particleCount * 3)

    const baseColor = new THREE.Color(activeColor)
    const secondaryColor = new THREE.Color(state === 'combat' ? '#ff8533' : '#4d7cff')

    for (let i = 0; i < particleCount; i++) {
      const u = Math.random()
      const v = Math.random()
      const theta = u * 2.0 * Math.PI
      const phi = Math.acos(2.0 * v - 1.0)
      const r = sphereRadius * (0.9 + Math.random() * 0.22)

      pBaseCoords.push({
        theta,
        phi,
        radius: r,
        speed: 0.4 + Math.random() * 0.8,
        seed: Math.random() * 10,
      })

      const x = r * Math.sin(phi) * Math.cos(theta)
      const y = r * Math.sin(phi) * Math.sin(theta)
      const z = r * Math.cos(phi)

      pPositions[i * 3] = x
      pPositions[i * 3 + 1] = y
      pPositions[i * 3 + 2] = z

      const mix = Math.random()
      const c = baseColor.clone().lerp(secondaryColor, mix * 0.6)
      pColors[i * 3] = c.r
      pColors[i * 3 + 1] = c.g
      pColors[i * 3 + 2] = c.b
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3))
    particleGeo.setAttribute('color', new THREE.BufferAttribute(pColors, 3))

    const particleMat = new THREE.PointsMaterial({
      size: 0.05,
      map: createGlowDotTexture(activeColor),
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const particleCloud = new THREE.Points(particleGeo, particleMat)
    hologramGroup.add(particleCloud)

    // Inner Glowing Core (Corpus Callosum / Synaptic Core)
    const coreGeo = new THREE.SphereGeometry(sphereRadius * 0.42, 16, 16)
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(activeColor),
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
    })
    const coreMesh = new THREE.Mesh(coreGeo, coreMat)
    hologramGroup.add(coreMesh)

    // -------------------------------------------------------------------------
    // Animation Loop
    // -------------------------------------------------------------------------
    let reqId = null
    const clock = new THREE.Clock()

    const animate = () => {
      reqId = requestAnimationFrame(animate)

      const delta = clock.getDelta()
      const elapsed = clock.getElapsedTime()
      const curState = stateRef.current
      const curLvl = audioLevelRef.current

      // Synaptic burst decay
      if (burstRef.current > 0.01) {
        burstRef.current -= delta * 1.5
      } else {
        burstRef.current = 0
      }
      const burst = burstRef.current

      let rotSpeed = 0.32
      let waveAmp = 0.09
      let pulseFreq = 2.2
      let coreScale = 1.0

      if (curState === 'thinking') {
        rotSpeed = 1.6
        waveAmp = 0.16
        pulseFreq = 5.2
      } else if (curState === 'speaking') {
        rotSpeed = 0.55
        waveAmp = 0.14 + curLvl * 0.28
        pulseFreq = 4.2
        coreScale = 1.0 + curLvl * 0.35
      } else if (curState === 'listening') {
        rotSpeed = 0.4
        waveAmp = 0.12 + curLvl * 0.25
        pulseFreq = 3.5
        coreScale = 1.0 + curLvl * 0.2
      } else if (curState === 'combat') {
        rotSpeed = 0.95
        waveAmp = 0.18
        pulseFreq = 6.0
      }

      if (burst > 0) {
        rotSpeed += burst * 2.5
        coreScale += burst * 0.5
      }

      // Smooth interaction rotation with mouse damping
      if (!isDraggingRef.current) {
        mouseRef.current.rotY += delta * rotSpeed
      }
      hologramGroup.rotation.y = mouseRef.current.rotY
      hologramGroup.rotation.x = mouseRef.current.rotX

      outerCage.rotation.y -= delta * (rotSpeed * 0.6)
      outerCage.rotation.z += delta * 0.2

      // Core pulse
      const corePulse = Math.sin(elapsed * pulseFreq) * 0.08
      coreMesh.scale.setScalar(coreScale + corePulse)
      coreMesh.material.opacity = 0.28 + (Math.sin(elapsed * pulseFreq) + 1) * 0.14 + (curLvl * 0.3) + (burst * 0.4)

      // Animate Synaptic Action Potentials
      const posArray = pulseGeo.attributes.position.array
      const speedMultiplier = (curState === 'thinking' ? 2.5 : curState === 'speaking' ? 1.8 : 1.0) + (burst * 3.0)

      for (let i = 0; i < pulseCount; i++) {
        const p = pulses[i]
        p.progress += delta * p.speed * speedMultiplier
        if (p.progress >= 1.0) {
          p.progress = 0
          p.from = p.to
          const neighbors = neuronNodes[p.from].neighbors
          if (neighbors.length > 0) {
            p.to = neighbors[Math.floor(Math.random() * neighbors.length)]
          }
        }
        const vFrom = neuronNodes[p.from].pos
        const vTo = neuronNodes[p.to].pos
        const curX = THREE.MathUtils.lerp(vFrom.x, vTo.x, p.progress)
        const curY = THREE.MathUtils.lerp(vFrom.y, vTo.y, p.progress)
        const curZ = THREE.MathUtils.lerp(vFrom.z, vTo.z, p.progress)

        posArray[i * 3] = curX
        posArray[i * 3 + 1] = curY
        posArray[i * 3 + 2] = curZ
      }
      pulseGeo.attributes.position.needsUpdate = true

      // Animate Particle Nebula & Waveform Ribbons
      const positions = particleGeo.attributes.position.array
      for (let i = 0; i < particleCount; i++) {
        const p = pBaseCoords[i]
        const wave = Math.sin(p.phi * 7.0 + elapsed * (3.0 * p.speed)) * 
                     Math.cos(p.theta * 4.0 - elapsed * 2.0) * waveAmp
        const audioDisplace = (curState === 'speaking' || curState === 'listening') 
          ? Math.sin(p.theta * 8.0 + elapsed * 6.0) * (curLvl * 0.2) 
          : 0
        const burstDisplace = burst * 0.15 * Math.sin(p.seed + elapsed * 10.0)

        const curR = p.radius + wave + audioDisplace + burstDisplace
        const x = curR * Math.sin(p.phi) * Math.cos(p.theta)
        const y = curR * Math.sin(p.phi) * Math.sin(p.theta)
        const z = curR * Math.cos(p.phi)

        positions[i * 3] = x
        positions[i * 3 + 1] = y
        positions[i * 3 + 2] = z
      }
      particleGeo.attributes.position.needsUpdate = true

      // Update color if theme or state changed
      const targetCol = new THREE.Color(
        curState === 'combat' ? '#ff2a4b' : curState === 'diagnostic' ? '#ffb800' : accentColorRef.current
      )
      wireframeMat.color.lerp(targetCol, 0.1)
      facetMat.color.lerp(targetCol, 0.1)
      outerMat.color.lerp(targetCol, 0.1)
      coreMat.color.lerp(targetCol, 0.1)
      axonMat.color.lerp(targetCol, 0.1)
      axonMat.opacity = 0.32 + burst * 0.4

      renderer.render(scene, camera)
    }

    animate()

    const handleResize = () => {
      if (!container) return
      const w = container.clientWidth || size
      const h = container.clientHeight || size
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    const ro = new ResizeObserver(handleResize)
    ro.observe(container)

    return () => {
      if (reqId) cancelAnimationFrame(reqId)
      ro.disconnect()
      renderer.dispose()
      icoGeo.dispose()
      nodeGeo.dispose()
      outerGeo.dispose()
      particleGeo.dispose()
      coreGeo.dispose()
      axonGeo.dispose()
      pulseGeo.dispose()
      wireframeMat.dispose()
      facetMat.dispose()
      nodeMat.dispose()
      outerMat.dispose()
      particleMat.dispose()
      coreMat.dispose()
      axonMat.dispose()
      pulseMat.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [size])

  // ---------------------------------------------------------------------------
  // LAYER 5: 2D Canvas Arc-Reactor HUD Rings Overlay (Image 2)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!showHudRings) return
    const cv = hudCanvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    let raf = null
    let angleOuter = 0
    let angleInner = 0
    let angleMid = 0

    const renderHud = () => {
      raf = requestAnimationFrame(renderHud)
      const w = cv.width
      const h = cv.height
      const cx = w / 2
      const cy = h / 2
      const radius = Math.min(cx, cy) * 0.94

      ctx.clearRect(0, 0, w, h)

      const curState = stateRef.current
      const curLvl = audioLevelRef.current
      const col = curState === 'combat' ? '#ff2a4b' : curState === 'diagnostic' ? '#ffb800' : accentColorRef.current

      const speedMult = curState === 'thinking' ? 2.5 : curState === 'combat' ? 2.0 : 1.0
      angleOuter += 0.003 * speedMult
      angleInner -= 0.005 * speedMult
      angleMid += 0.002 * speedMult

      // Outer Ticks
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(angleOuter)
      ctx.strokeStyle = col
      ctx.lineWidth = 1.2
      ctx.globalAlpha = 0.35

      const totalTicks = 72
      for (let i = 0; i < totalTicks; i++) {
        const a = (i * Math.PI * 2) / totalTicks
        const isMajor = i % 6 === 0
        const isSemi = i % 3 === 0
        const len = isMajor ? 10 : isSemi ? 6 : 3
        const r1 = radius
        const r2 = radius - len

        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1)
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2)
        ctx.stroke()

        if (isMajor && radius > 100) {
          ctx.save()
          ctx.fillStyle = col
          ctx.font = '7px Orbitron, monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          const deg = (i * 5).toString().padStart(3, '0') + '°'
          ctx.fillText(deg, Math.cos(a) * (r2 - 9), Math.sin(a) * (r2 - 9))
          ctx.restore()
        }
      }
      ctx.restore()

      // Segmented Thick Arc Reactor Brackets
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(angleInner)
      ctx.strokeStyle = col
      ctx.shadowColor = col
      ctx.shadowBlur = 8
      ctx.lineWidth = 2.5
      ctx.globalAlpha = 0.65

      const arcR = radius * 0.88
      const segments = [
        { start: 0.1, end: 1.1 },
        { start: 1.4, end: 2.2 },
        { start: 2.5, end: 3.7 },
        { start: 4.1, end: 5.6 },
      ]
      segments.forEach(seg => {
        ctx.beginPath()
        ctx.arc(0, 0, arcR, seg.start, seg.end)
        ctx.stroke()

        const tx = Math.cos(seg.start) * arcR
        const ty = Math.sin(seg.start) * arcR
        ctx.fillStyle = col
        ctx.beginPath()
        ctx.arc(tx, ty, 2.5, 0, Math.PI * 2)
        ctx.fill()
      })
      ctx.restore()

      // Radial Audio Equalizer Bars
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(angleMid)
      ctx.strokeStyle = col
      ctx.lineWidth = 1.5

      const numBars = 54
      const eqBaseR = radius * 0.76
      for (let i = 0; i < numBars; i++) {
        const a = (i * Math.PI * 2) / numBars
        const wave = Math.sin(i * 0.6 + angleOuter * 8) * 0.5 + 0.5
        const barHeight = (4 + wave * 12 + curLvl * 22)
        
        ctx.globalAlpha = 0.3 + wave * 0.45
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * eqBaseR, Math.sin(a) * eqBaseR)
        ctx.lineTo(Math.cos(a) * (eqBaseR - barHeight), Math.sin(a) * (eqBaseR - barHeight))
        ctx.stroke()
      }
      ctx.restore()

      // Crosshairs
      ctx.save()
      ctx.translate(cx, cy)
      ctx.strokeStyle = col
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.45

      const crosshairSize = radius * 0.98
      ctx.beginPath()
      ctx.moveTo(-crosshairSize, 0)
      ctx.lineTo(-radius * 0.82, 0)
      ctx.moveTo(crosshairSize, 0)
      ctx.lineTo(radius * 0.82, 0)
      ctx.moveTo(0, -crosshairSize)
      ctx.lineTo(0, -radius * 0.82)
      ctx.moveTo(0, crosshairSize)
      ctx.lineTo(0, radius * 0.82)
      ctx.stroke()

      ctx.fillStyle = col
      ctx.beginPath()
      ctx.arc(0, 0, 1.8, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    renderHud()

    return () => {
      if (raf) cancelAnimationFrame(raf)
    }
  }, [showHudRings, activeColor])

  const handlePointerDown = (e) => {
    if (!interactive) return
    isDraggingRef.current = true
    mouseRef.current.lastX = e.clientX || (e.touches && e.touches[0].clientX) || 0
    mouseRef.current.lastY = e.clientY || (e.touches && e.touches[0].clientY) || 0
    jarvisAudio.playBeep(920, 'sine', 0.05, 0.03)
  }

  const handlePointerMove = (e) => {
    if (!isDraggingRef.current) return
    const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0
    const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0
    const dx = clientX - mouseRef.current.lastX
    const dy = clientY - mouseRef.current.lastY

    mouseRef.current.rotY += dx * 0.012
    mouseRef.current.rotX = Math.max(-0.8, Math.min(0.8, mouseRef.current.rotX + dy * 0.012))

    mouseRef.current.lastX = clientX
    mouseRef.current.lastY = clientY
  }

  const handlePointerUp = () => {
    isDraggingRef.current = false
  }

  const pixelSize = typeof size === 'number' ? size : 320

  return (
    <div
      className={`relative select-none flex items-center justify-center ${className}`}
      style={{
        width: typeof size === 'number' ? `${size}px` : size,
        height: typeof size === 'number' ? `${size}px` : size,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onClick={onClick}
      role={onClick ? 'button' : 'region'}
      aria-label="JARVIS Neural Holographic Core"
    >
      <div
        className="absolute inset-4 rounded-full pointer-events-none transition-all duration-700 blur-2xl opacity-40"
        style={{
          background: `radial-gradient(circle, ${activeColor} 0%, rgba(0, 240, 255, 0.15) 45%, transparent 70%)`,
        }}
      />

      {showHudRings && (
        <canvas
          ref={hudCanvasRef}
          width={pixelSize * 2}
          height={pixelSize * 2}
          className="absolute inset-0 w-full h-full pointer-events-none z-10"
        />
      )}

      <div
        ref={mountRef}
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing z-0"
      />

      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none text-center">
        <span
          className="px-2 py-0.5 rounded text-[9px] font-mono tracking-widest uppercase border backdrop-blur-md"
          style={{
            color: activeColor,
            borderColor: `${activeColor}40`,
            background: 'rgba(2, 6, 16, 0.65)',
            textShadow: `0 0 8px ${activeColor}`,
          }}
        >
          {state === 'combat'
            ? 'SYNAPSE: RED ALERT'
            : state === 'listening'
            ? 'AUDIO SYNAPSE: ACTIVE'
            : state === 'thinking'
            ? 'NEURAL CORTEX: PROCESSING'
            : state === 'speaking'
            ? 'VOCAL SYNTH: BROADCASTING'
            : 'NEURAL CORE // 1,024 TERAFLOPS'}
        </span>
      </div>
    </div>
  )
}

/**
 * FLOATING HOLOGRAPHIC FRAMES (Image 3)
 * Curved holographic panels with actionable items floating in 3D orbit around the neural core.
 */
export function FloatingHoloFramesOrbit({
  frames = [],
  activeFrame = null,
  onSelectFrame,
  onExecuteAction,
  autoRotate = true,
  accentColor = '#00f0ff',
  className = '',
}) {
  const [orbitAngle, setOrbitAngle] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [dragStart, setDragStart] = useState(null)
  const angleRef = useRef(0)
  angleRef.current = orbitAngle

  // Auto orbital rotation
  useEffect(() => {
    if (!autoRotate || isPaused) return
    const id = setInterval(() => {
      setOrbitAngle(prev => (prev + 0.35) % 360)
    }, 40)
    return () => clearInterval(id)
  }, [autoRotate, isPaused])

  const handlePointerDown = e => {
    setDragStart(e.clientX || (e.touches && e.touches[0].clientX) || 0)
    setIsPaused(true)
  }

  const handlePointerMove = e => {
    if (dragStart === null) return
    const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0
    const delta = clientX - dragStart
    setOrbitAngle(prev => (prev + delta * 0.45) % 360)
    setDragStart(clientX)
  }

  const handlePointerUp = () => {
    setDragStart(null)
    setIsPaused(false)
  }

  const total = frames.length || 1
  const containerRef = useRef(null)
  const [containerWidth, setContainerWidth] = useState(800)

  // Measure container width to dynamically calibrate orbital radius and avoid any card cutoff
  useEffect(() => {
    if (!containerRef.current) return
    const updateSize = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth || 800)
      }
    }
    updateSize()
    const ro = new ResizeObserver(updateSize)
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // Calculate dynamic radius: keeps cards inside viewport boundaries without clipping
  // On wide screens (~1000px): ~250px radius. On mobile/compact: ~180px-210px radius.
  const dynamicRadius = Math.max(175, Math.min(265, Math.floor(containerWidth * 0.28)))

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full select-none ${className}`}
      style={{ perspective: '1400px' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* 3D Cylindrical Orbital Container */}
      <div
        className="absolute inset-0 flex items-center justify-center transition-transform duration-100 ease-out"
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateY(${orbitAngle}deg)`,
        }}
      >
        {frames.map((frame, idx) => {
          const baseAngle = (360 / total) * idx
          // Calculate relative angle to viewer (0 deg = facing camera)
          const relAngle = ((baseAngle + orbitAngle) % 360 + 360) % 360
          // Depth factor: 1 when facing camera, 0 when behind
          const rad = (relAngle * Math.PI) / 180
          const zDepth = Math.cos(rad)
          const isFront = zDepth > -0.3
          const opacity = Math.max(0.2, (zDepth + 1) / 2)
          const isCurrentActive = activeFrame === frame.id

          // Responsive scaled sizing: cards are compact and sharp (Image 3 style)
          const scale = 0.72 + 0.24 * Math.max(0, zDepth)

          return (
            <div
              key={frame.id || idx}
              onClick={e => {
                e.stopPropagation()
                onSelectFrame && onSelectFrame(frame.id)
                jarvisAudio.playBeep(840, 'sine', 0.04, 0.02)
              }}
              className={`absolute w-[185px] sm:w-[200px] md:w-[218px] p-2 sm:p-2.5 rounded-lg border backdrop-blur-md transition-all duration-300 pointer-events-auto cursor-pointer ${
                isCurrentActive
                  ? 'border-[var(--ui-accent)] shadow-[0_0_22px_rgba(0,240,255,0.4)] bg-[rgba(6,16,28,0.94)] z-30'
                  : 'border-[var(--ui-stroke-secondary)] bg-[rgba(4,10,20,0.78)] hover:border-[var(--ui-accent)] hover:bg-[rgba(6,16,28,0.92)]'
              }`}
              style={{
                transform: `rotateY(${baseAngle}deg) translateZ(${dynamicRadius}px) rotateY(${-baseAngle - orbitAngle}deg) scale(${scale})`,
                opacity: isFront ? opacity : opacity * 0.4,
                zIndex: Math.round((zDepth + 1) * 20),
                filter: isFront ? 'none' : 'blur(0.8px)',
              }}
            >
              {/* Tactical Corner Brackets */}
              <div className="hud-brackets" />

              {/* Holographic Scanline Overlay */}
              <div className="absolute inset-0 pointer-events-none opacity-20 bg-[linear-gradient(rgba(0,240,255,0.1)_1px,transparent_1px)] bg-[size:100%_3px] rounded-lg" />

              {/* Frame Header */}
              <div className="flex items-center justify-between border-b border-[var(--ui-stroke-secondary)] pb-1 mb-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--ui-accent)] shadow-[0_0_5px_var(--ui-accent)] flex-none" />
                  <span className="font-mono text-[9px] sm:text-[10px] font-bold tracking-wider text-[var(--ui-accent)] truncate uppercase">
                    {frame.title}
                  </span>
                </div>
                <span className="font-mono text-[7.5px] sm:text-[8px] px-1 py-0.2 rounded bg-[var(--ui-accent)]/10 text-[var(--ui-accent)] border border-[var(--ui-accent)]/30 uppercase flex-none">
                  {frame.tag || 'LINK'}
                </span>
              </div>

              {/* Status Metric / Telemetry */}
              <div className="space-y-0.5 mb-2">
                <div className="flex items-baseline justify-between text-[10px] font-mono">
                  <span className="text-[var(--ui-text-tertiary)] text-[8px] sm:text-[8.5px] uppercase">
                    {frame.metricLabel || 'STATUS'}
                  </span>
                  <span className="text-slate-100 font-bold text-[10px] sm:text-[11px]">
                    {frame.metricValue || '100%'}
                  </span>
                </div>
                {frame.progress != null && (
                  <div className="h-1 rounded-full bg-[var(--ui-accent)]/15 overflow-hidden">
                    <div
                      className="h-full bg-[var(--ui-accent)] shadow-[0_0_6px_var(--ui-accent)]"
                      style={{ width: `${frame.progress}%` }}
                    />
                  </div>
                )}
                {frame.description && (
                  <p className="text-[8px] sm:text-[8.5px] text-[var(--ui-text-tertiary)] line-clamp-1 leading-tight mt-0.5">
                    {frame.description}
                  </p>
                )}
              </div>

              {/* Actionable Items Buttons */}
              <div className="space-y-1 pt-1 border-t border-[var(--ui-stroke-secondary)]/50">
                {(frame.actions || []).map((action, aIdx) => (
                  <button
                    key={aIdx}
                    type="button"
                    onClick={e => {
                      e.stopPropagation()
                      jarvisAudio.playHudChirp('engage')
                      onExecuteAction && onExecuteAction(action.id, frame.id, action)
                    }}
                    className={`w-full py-0.5 sm:py-1 px-1.5 rounded text-[8.5px] sm:text-[9.5px] font-mono tracking-wide text-left flex items-center justify-between transition-colors ${
                      action.primary
                        ? 'bg-[var(--ui-accent)]/15 border border-[var(--ui-accent)] text-[var(--ui-accent)] hover:bg-[var(--ui-accent)]/30'
                        : 'bg-black/30 border border-[var(--ui-stroke-secondary)] text-slate-300 hover:border-[var(--ui-accent)] hover:text-white'
                    }`}
                  >
                    <span className="truncate flex items-center gap-1">
                      <span className="text-[var(--ui-accent)]">▸</span> {action.label}
                    </span>
                    {action.badge && (
                      <span className="text-[7.5px] opacity-75 font-mono">{action.badge}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Orbit Navigation Controls at Bottom */}
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 pointer-events-auto">
        <button
          type="button"
          onClick={() => {
            jarvisAudio.playBeep(700, 'sine', 0.03, 0.02)
            setOrbitAngle(a => a + (360 / total))
          }}
          className="px-1.5 py-0.5 rounded bg-[rgba(6,16,28,0.85)] border border-[var(--ui-stroke-secondary)] hover:border-[var(--ui-accent)] text-[var(--ui-accent)] text-[10px] font-mono cursor-pointer transition-colors"
          title="Orbit Previous Frame"
        >
          ◀
        </button>
        <span className="font-mono text-[8.5px] uppercase tracking-widest text-[var(--ui-text-tertiary)] px-2 py-0.5 rounded bg-black/60 border border-[var(--ui-stroke-secondary)] backdrop-blur-sm">
          ORBITING MATRIX [{frames.length} NODES]
        </span>
        <button
          type="button"
          onClick={() => {
            jarvisAudio.playBeep(700, 'sine', 0.03, 0.02)
            setOrbitAngle(a => a - (360 / total))
          }}
          className="px-1.5 py-0.5 rounded bg-[rgba(6,16,28,0.85)] border border-[var(--ui-stroke-secondary)] hover:border-[var(--ui-accent)] text-[var(--ui-accent)] text-[10px] font-mono cursor-pointer transition-colors"
          title="Orbit Next Frame"
        >
          ▶
        </button>
      </div>
    </div>
  )
}
