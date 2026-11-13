/**
 * jarvis-deck — standalone JARVIS-style control deck for your agent.
 * Data from the FastAPI backend (dashboard/plugin_api.py), mounted at
 * /api/plugins/agentos (standalone runner: dashboard/standalone.py).
 * Point it at any agent backend by editing agentos.yaml (see README).
 */
import {
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  useQuery,
  useQueryClient,
  host,
  haptic,
  cn
} from '@hermes/plugin-sdk'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState, useMemo, Component } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { LOGOS } from './logos.js'

let REST = null
let openExternal = null // set in register(): ctx.os.openExternal, window.open fallback

// ------------------------------------------------------------ style

const CSS = `
@keyframes aoFadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes aoPulse { 0%,100% { box-shadow: 0 0 0 0 currentColor; opacity: 1; } 50% { box-shadow: 0 0 7px 2px currentColor; opacity: .75; } }
@keyframes aoShimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@keyframes aoSpin { to { transform: rotate(360deg); } }
@keyframes aoBreathe { 0%,100% { transform: scale(1); opacity: .85; } 50% { transform: scale(1.08); opacity: 1; } }
@keyframes aoDrift { from { transform: translate3d(-2%, -1%, 0) scale(1); } to { transform: translate3d(2%, 2%, 0) scale(1.06); } }
@keyframes aoGlowLine { 0%,100% { opacity: .25; } 50% { opacity: .8; } }
.ao-in { animation: aoFadeUp .5s cubic-bezier(.2,.7,.3,1) both; }

/* --- card: glass panel, accent edge on hover --- */
.ao-card { position: relative; overflow: hidden; --mx: 50%; --my: 0%;
  border: 1px solid var(--ui-stroke-secondary); border-radius: 14px; padding: 14px;
  background: color-mix(in srgb, var(--ui-card) 62%, transparent);
  backdrop-filter: blur(14px);
  transition: border-color .25s ease, box-shadow .25s ease, transform .25s ease; }
.ao-card:hover { border-color: color-mix(in srgb, var(--ui-accent) 40%, var(--ui-stroke-secondary));
  box-shadow: 0 8px 40px color-mix(in srgb, var(--ui-accent) 7%, transparent),
              inset 0 1px 0 color-mix(in srgb, white 6%, transparent); }
.ao-card::before { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background: radial-gradient(280px circle at var(--mx) var(--my),
    color-mix(in srgb, var(--ui-accent) 7%, transparent), transparent 70%);
  opacity: 0; transition: opacity .3s; }
.ao-card:hover::before { opacity: 1; }
.ao-card[data-dragging='1'] { opacity: .45; transform: scale(.99); }
.ao-card[data-droppable='1'] { border-color: var(--ui-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent) 35%, transparent); }

/* --- full-viewport modes (Alt+1..4) + HUD companion --- */
.ao-mode { position: fixed; inset: 0; z-index: 40; display: flex; flex-direction: column;
  background: color-mix(in srgb, #060a10 90%, transparent); backdrop-filter: blur(18px); }
.ao-mode-bar { display: flex; align-items: center; gap: 10px; padding: 10px 18px;
  border-bottom: 1px solid var(--ui-stroke-secondary); flex-shrink: 0; }
.ao-hud { position: fixed; left: 50%; top: 14px; transform: translateX(-50%);
  z-index: 40; width: min(560px, 92vw); border-radius: 16px; padding: 14px 18px;
  border: 1px solid var(--ui-stroke-secondary);
  background: color-mix(in srgb, var(--ui-card) 72%, transparent);
  backdrop-filter: blur(18px); box-shadow: 0 12px 48px rgba(0,0,0,.45); }
/* Electron HUD companion: whole panel drags the frameless window; buttons stay clickable */
.ao-hud-drag { -webkit-app-region: drag; }
.ao-hud-drag button, .ao-hud-drag input, .ao-hud-drag a { -webkit-app-region: no-drag; }
/* companion: kill the opaque page background so the OS-level transparent
   window is actually see-through, and pin the panel to the window bounds
   (no more blank dark margins around it) */
html.ao-companion, html.ao-companion body, html.ao-companion #root { background: transparent !important; }
.ao-hud-fill { left: 8px; right: 8px; top: 8px; transform: none; width: auto;
  background: color-mix(in srgb, var(--ui-card) 55%, transparent); }

.ao-label { font-size: .6875rem; text-transform: uppercase; letter-spacing: .14em; color: var(--ui-text-tertiary); }
.ao-num { font-variant-numeric: tabular-nums; font-size: 1.6rem; font-weight: 600; line-height: 1.1;
  text-shadow: 0 0 18px color-mix(in srgb, var(--ui-accent) 35%, transparent); }
.ao-led { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: currentColor;
  animation: aoPulse 2.4s ease-in-out infinite; }
.ao-logo { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ao-logo svg { display: block; }
.ao-logo-mono { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  border-radius: 4px; background: color-mix(in srgb, var(--ui-accent) 8%, var(--ui-tertiary-background));
  color: var(--ui-text-secondary); font-family: var(--font-mono); font-weight: 600; line-height: 1; }
.ao-skel { border-radius: 6px; background:
  linear-gradient(90deg, transparent, color-mix(in srgb, var(--ui-accent) 12%, transparent), transparent);
  background-size: 200% 100%; animation: aoShimmer 1.5s linear infinite; }
.ao-ring { animation: aoSpin 2.4s linear infinite; transform-origin: center; }
.ao-bar { height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--ui-accent) 16%, transparent); overflow: hidden; }
.ao-bar > i { display: block; height: 100%; border-radius: 3px; background: var(--ui-accent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--ui-accent) 60%, transparent);
  transition: width .8s cubic-bezier(.2,.7,.3,1); }

/* --- ambient page aurora --- */
.ao-aurora { position: absolute; inset: -1px; pointer-events: none; overflow: hidden; border-radius: 14px;
  background:
    radial-gradient(640px 300px at 18% 0%, color-mix(in srgb, var(--ui-accent) 10%, transparent), transparent 70%),
    radial-gradient(720px 340px at 82% 12%, color-mix(in srgb, var(--ui-accent) 6%, transparent), transparent 72%),
    radial-gradient(560px 260px at 50% 100%, color-mix(in srgb, var(--ui-accent) 4%, transparent), transparent 75%);
  animation: aoDrift 16s ease-in-out infinite alternate; }
.ao-aurora::after { content: ''; position: absolute; inset: 0;
  background-image:
    linear-gradient(color-mix(in srgb, var(--ui-accent) 4%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--ui-accent) 4%, transparent) 1px, transparent 1px);
  background-size: 44px 44px; }

/* --- HUD skin --- */
.ao-label::before { content: '// '; color: var(--ui-accent); }
.ao-corner-tl, .ao-corner-br { position: absolute; width: 14px; height: 14px; pointer-events: none; opacity: .5; z-index: 5; }
.ao-corner-tl { top: 4px; left: 4px; border-top: 1px solid var(--ui-accent); border-left: 1px solid var(--ui-accent); border-top-left-radius: 4px; }
.ao-corner-br { bottom: 4px; right: 4px; border-bottom: 1px solid var(--ui-accent); border-right: 1px solid var(--ui-accent); border-bottom-right-radius: 4px; }

/* --- modular widget grid (fixed row units so cards resize in both axes) --- */
.ao-grid12 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; align-items: stretch; grid-auto-rows: 92px; }
@media (min-width: 900px) { .ao-grid12 { grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; } }
.ao-w-3 { grid-column: span 1; } .ao-w-4 { grid-column: span 2; } .ao-w-6 { grid-column: span 2; } .ao-w-12 { grid-column: span 4; }
@media (min-width: 900px) {
  .ao-w-3 { grid-column: span 3; } .ao-w-4 { grid-column: span 4; }
  .ao-w-6 { grid-column: span 6; } .ao-w-8 { grid-column: span 8; } .ao-w-12 { grid-column: span 12; }
}
.ao-grid-flip { transition: transform .35s cubic-bezier(.2,.7,.3,1), opacity .35s ease; }

/* --- hero strip --- */
.ao-hero { position: relative; overflow: hidden; display: flex; align-items: center; gap: 18px;
  border: 1px solid color-mix(in srgb, var(--ui-accent) 22%, var(--ui-stroke-secondary));
  border-radius: 16px; padding: 18px;
  background: color-mix(in srgb, var(--ui-accent) 3%, transparent); }
.ao-hero-glow { text-shadow: 0 0 22px color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.ao-hero-stats { display: flex; flex-wrap: wrap; gap: 22px; }
.ao-kbd { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 7px;
  border: 1px solid var(--ui-stroke-secondary);
  background: color-mix(in srgb, var(--ui-card) 80%, transparent);
  font: 500 0.6875rem/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ui-text-tertiary); }
.ao-press { transition: color .25s cubic-bezier(.23,1,.32,1), transform .25s cubic-bezier(.23,1,.32,1), border-color .25s cubic-bezier(.23,1,.32,1), box-shadow .25s cubic-bezier(.23,1,.32,1); }
.ao-press:active { transform: scale(.97); }
.ao-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 8px;
  border: 1px solid var(--ui-stroke-secondary);
  font: 500 0.7rem/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ui-text-secondary);
  cursor: pointer;
  transition: transform .15s cubic-bezier(.23,1,.32,1), border-color .2s, color .2s;
  background: color-mix(in srgb, var(--ui-card) 80%, transparent); }
.ao-btn:active { transform: scale(.97); }
.ao-btn:hover { border-color: var(--ui-accent); color: var(--ui-accent); }
.ao-btn[data-kind='run']:hover { border-color: #a855f7; color: #a855f7; }
.ao-btn[data-kind='restart']:hover { border-color: #ffb84d; color: #ffb84d; }
.ao-btn[data-kind='delegate']:hover { border-color: #5cd6ff; color: #5cd6ff; }
.ao-btn:disabled { opacity: .4; pointer-events: none; }
.ao-range { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 2px;
  background: color-mix(in srgb, var(--ui-accent) 18%, transparent); outline: none; cursor: pointer; }
.ao-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%;
  background: var(--ui-accent); box-shadow: 0 0 8px color-mix(in srgb, var(--ui-accent) 70%, transparent); cursor: pointer; }
.ao-range::-moz-range-thumb { width: 14px; height: 14px; border: none; border-radius: 50%;
  background: var(--ui-accent); box-shadow: 0 0 8px color-mix(in srgb, var(--ui-accent) 70%, transparent); cursor: pointer; }
.ao-select { background: color-mix(in srgb, var(--ui-card) 90%, transparent); border: 1px solid var(--ui-stroke-secondary);
  border-radius: 8px; padding: 4px 8px; font: 500 0.75rem/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ui-text-secondary); outline: none; cursor: pointer; }
.ao-select:focus { border-color: var(--ui-accent); }
.ao-select option { background: #0a0e14; color: var(--ui-text-primary); }
.ao-mini-term { font: 400 .65rem/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: rgba(0,0,0,.45); border-radius: 4px; padding: 3px 6px; margin-top: 4px;
  max-height: 5.4rem; overflow-y: auto; white-space: pre-wrap; word-break: break-all; color: #5cd6ff; }
.ao-mini-term::-webkit-scrollbar { width: 4px; }
.ao-mini-term::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--ui-accent) 20%, transparent); border-radius: 2px; }
.ao-svc-drawer { position: fixed; right: 0; top: 0; bottom: 0; width: 380px; max-width: 90vw; z-index: 900;
  background: color-mix(in srgb, var(--ui-card) 90%, transparent);
  backdrop-filter: blur(18px); border-left: 1px solid var(--ui-stroke-secondary);
  box-shadow: -8px 0 40px rgba(0,0,0,.45);
  display: flex; flex-direction: column;
  transform: translateX(100%); transition: transform .25s cubic-bezier(.23,1,.32,1); }
.ao-svc-drawer[data-open='1'] { transform: translateX(0); }
.ao-svc-drawer-header { display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--ui-stroke-secondary); }
.ao-svc-drawer-body { flex: 1; overflow-y: auto; padding: 10px 16px; }
.ao-svc-drawer-body::-webkit-scrollbar { width: 6px; }
.ao-svc-drawer-body::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--ui-accent) 20%, transparent); border-radius: 3px; }

/* --- spotlight command runner --- */
.ao-spot-backdrop { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: flex-start;
  justify-content: center; padding-top: 12vh;
  background: color-mix(in srgb, var(--ui-background, black) 55%, transparent);
  backdrop-filter: blur(6px); }
.ao-spot { width: min(620px, calc(100vw - 32px)); border-radius: 16px; overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-accent) 35%, var(--ui-stroke-secondary));
  background: color-mix(in srgb, var(--ui-card) 92%, transparent);
  box-shadow: 0 24px 80px rgba(0,0,0,.55), 0 0 60px color-mix(in srgb, var(--ui-accent) 12%, transparent);
  animation: aoFadeUp .18s cubic-bezier(.2,.7,.3,1) both; }
.ao-spot-input { display: flex; align-items: center; gap: 10px; padding: 14px 16px;
  border-bottom: 1px solid var(--ui-stroke-secondary); }
.ao-spot-input input { flex: 1; min-width: 0; background: transparent; border: none; outline: none;
  font-size: 1rem; color: var(--ui-text-primary); }
.ao-spot-input input::placeholder { color: var(--ui-text-tertiary); }
.ao-spot-list { max-height: 46vh; overflow-y: auto; padding: 6px; }
.ao-spot-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 10px;
  cursor: pointer; color: var(--ui-text-secondary); font-size: .875rem; }
.ao-spot-row:hover, .ao-spot-row[data-sel='1'] { background: color-mix(in srgb, var(--ui-accent) 10%, transparent);
  color: var(--ui-text-primary); }
.ao-spot-sec { padding: 8px 12px 4px; font-size: .625rem; text-transform: uppercase; letter-spacing: .14em;
  color: var(--ui-text-tertiary); }
.ao-spot-foot { display: flex; align-items: center; gap: 14px; padding: 8px 14px;
  border-top: 1px solid var(--ui-stroke-secondary);
  font-size: .6875rem; color: var(--ui-text-tertiary); }

/* --- pinned command dock rail --- */
.ao-dock { position: sticky; top: 0; align-self: start; width: 300px; flex: none;
  display: flex; flex-direction: column; gap: 12px; max-height: calc(100vh - 120px); }
.ao-wordmark { letter-spacing: .2em; }
@media (max-width: 899px) { .ao-dock { display: none; } }

/* --- widgets --- */
.ao-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 130px; padding: 4px 10px;
  border-radius: 999px; border: 1px solid var(--ui-stroke-secondary);
  background: color-mix(in srgb, var(--ui-card) 85%, transparent);
  font: 500 0.6875rem/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ui-text-secondary); white-space: nowrap;
  box-shadow: 0 4px 14px rgba(0, 0, 0, .28); will-change: transform, opacity; }
.ao-chip > i { width: 6px; height: 6px; border-radius: 50%; background: var(--ui-accent);
  box-shadow: 0 0 6px color-mix(in srgb, var(--ui-accent) 70%, transparent); flex: none; }
.ao-chip > span { overflow: hidden; text-overflow: ellipsis; }
.ao-orbit-center { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 10px; height: 10px; border-radius: 50%; background: var(--ui-accent);
  box-shadow: 0 0 18px color-mix(in srgb, var(--ui-accent) 80%, transparent); opacity: .8; }
.ao-orbit-item { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }
.ao-orbit-stage { position: relative; height: 300px; width: 100%; overflow: hidden; border-radius: 6px; }
.ao-dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; cursor: pointer;
  border: 1px solid transparent; transition: transform .15s ease, box-shadow .15s ease; }
.ao-dot:hover { transform: scale(1.2); }
.ao-dot[data-active='1'] { border-color: var(--ui-text-primary); box-shadow: 0 0 8px currentColor; }
.ao-vision-img { max-height: 180px; border-radius: 8px; border: 1px solid var(--ui-stroke-secondary); }
.ao-runbtn { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 4px 10px;
  border-radius: 8px; border: 1px solid var(--ui-stroke-secondary); text-align: left;
  font: 500 0.75rem/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ui-text-secondary); transition: border-color .2s ease, color .2s ease; }
.ao-runbtn:hover { border-color: var(--ui-accent); color: var(--ui-accent); }
.ao-mini-orb { width: 26px; height: 26px; border-radius: 50%; flex: none;
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--ui-accent) 85%, white 10%), color-mix(in srgb, var(--ui-accent) 40%, transparent) 55%, transparent 72%);
  animation: aoBreathe 2.6s ease-in-out infinite; }
.ao-mini-orb[data-busy='1'] { animation-duration: 1.1s; }

/* --- fixed-height grid cells: cards fill their cell, content scrolls --- */
.ao-grid12 > div { min-width: 0; min-height: 0; }
.ao-grid12 .ao-card { height: 100%; display: flex; flex-direction: column; }
.ao-grid12 .ao-card .ao-body { flex: 1; min-height: 0; }
.ao-grid12 .ao-card .ao-body-inner { height: 100%; overflow-y: auto; }
.ao-grid12 .ao-card .ao-body-inner::-webkit-scrollbar { width: 8px; }
.ao-grid12 .ao-card .ao-body-inner::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--ui-accent) 25%, transparent); border-radius: 4px; }
.ao-grid12 .ao-hero { height: 100%; overflow: hidden; }

/* --- resize handle (customize mode) --- */
.ao-resize { position: absolute; right: 3px; bottom: 3px; width: 20px; height: 20px; z-index: 40;
  display: flex; align-items: center; justify-content: center; cursor: nwse-resize; touch-action: none;
  color: var(--ui-text-quaternary); font-size: .7rem; line-height: 1;
  border: 1px solid var(--ui-stroke-secondary); border-radius: 5px;
  background: color-mix(in srgb, var(--ui-card) 92%, transparent); }
.ao-resize:hover { color: var(--ui-accent); border-color: var(--ui-accent); }

/* --- widget chrome (customize mode) --- */
.ao-wbtn { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px;
  border-radius: 6px; border: 1px solid transparent; color: var(--ui-text-quaternary);
  cursor: pointer; font-size: .7rem; line-height: 1; transition: color .15s, border-color .15s; }
.ao-wbtn:hover { color: var(--ui-text-primary); border-color: var(--ui-stroke-secondary); }
.ao-wbtn[draggable='true'] { cursor: grab; }
.ao-tabline { position: absolute; bottom: 0; height: 2px; width: 20%;
  background: var(--ui-accent); box-shadow: 0 0 10px color-mix(in srgb, var(--ui-accent) 70%, transparent);
  transition: transform .3s cubic-bezier(.2,.7,.3,1); }

/* --- collapsible cards --- */
.ao-collapse { display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 6px; border: 1px solid transparent;
  color: var(--ui-text-quaternary); cursor: pointer; flex: none;
  transition: transform .25s cubic-bezier(.2,.7,.3,1), color .15s, border-color .15s; }
.ao-collapse:hover { color: var(--ui-text-primary); border-color: var(--ui-stroke-secondary); }
.ao-collapse[data-open='1'] { transform: rotate(90deg); }
.ao-body { display: grid; grid-template-rows: minmax(0, 1fr);
  transition: grid-template-rows .32s cubic-bezier(.2,.7,.3,1); }
.ao-body[data-open='0'] { grid-template-rows: minmax(0, 0fr); }
.ao-body-inner { min-height: 0; overflow: hidden; }

/* --- orb HUD rings + orbiting panels --- */
.ao-orb-hud { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }

/* --- holo stage: plasma core glow + platform base + glass frames --- */
.ao-orb-coreglow { position: absolute; inset: 0; pointer-events: none; z-index: 1;
  background: radial-gradient(circle at 50% 50%,
    rgba(235, 250, 255, 0.95) 0%, rgba(140, 220, 255, 0.5) 13%,
    color-mix(in srgb, var(--ui-accent) 32%, transparent) 30%, transparent 58%); }
.ao-orb-coreglow[data-state='listening'] {
  background: radial-gradient(circle at 50% 50%,
    rgba(255, 233, 230, 0.95) 0%, rgba(255, 124, 112, 0.5) 13%,
    rgba(248, 81, 73, 0.22) 30%, transparent 58%); }
.ao-orb-base { position: absolute; left: 50%; bottom: -6px; width: 216px; height: 30px; transform: translateX(-50%);
  pointer-events: none; z-index: 0; border-radius: 50%; filter: blur(0.5px);
  background: radial-gradient(ellipse at center,
    color-mix(in srgb, var(--ui-accent) 42%, transparent) 0%,
    color-mix(in srgb, var(--ui-accent) 12%, transparent) 45%, transparent 70%); }
.ao-orb-base::after { content: ''; position: absolute; inset: 7px 20px; border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--ui-accent) 45%, transparent); border-top-color: transparent;
  box-shadow: 0 0 10px color-mix(in srgb, var(--ui-accent) 25%, transparent); }
.ao-frame { position: absolute; width: 104px; padding: 6px 8px; pointer-events: auto;
  background: linear-gradient(165deg,
    color-mix(in srgb, var(--ui-accent) 9%, rgba(6, 16, 28, 0.8)),
    rgba(4, 10, 20, 0.6));
  border: 1px solid color-mix(in srgb, var(--ui-accent) 38%, transparent);
  border-radius: 6px;
  box-shadow: 0 0 14px color-mix(in srgb, var(--ui-accent) 16%, transparent),
    inset 0 0 18px color-mix(in srgb, var(--ui-accent) 7%, transparent);
  animation: aoFrameFloat 7s ease-in-out infinite; }
.ao-fr-lt { left: -6px; top: 14px; --tilt: 13deg; }
.ao-fr-lb { left: -6px; bottom: 10px; --tilt: 13deg; }
.ao-fr-rt { right: -6px; top: 14px; --tilt: -13deg; }
.ao-fr-rb { right: -6px; bottom: 10px; --tilt: -13deg; }
@keyframes aoFrameFloat {
  0%, 100% { transform: perspective(520px) rotateY(var(--tilt, 0deg)) translateY(0); }
  50% { transform: perspective(520px) rotateY(var(--tilt, 0deg)) translateY(-5px); }
}
.ao-frame-head { display: flex; align-items: center; gap: 4px; font-family: var(--ui-font-mono, ui-monospace, monospace);
  font-size: 0.5rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ui-text-quaternary); margin-bottom: 3px; }
.ao-frame-head i { width: 4px; height: 4px; border-radius: 999px; background: var(--ui-accent);
  box-shadow: 0 0 6px var(--ui-accent); flex: none; }
.ao-frame-head span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ao-frame-num { font-size: 1rem; font-weight: 650; line-height: 1.1; color: var(--ui-text-primary);
  text-shadow: 0 0 12px color-mix(in srgb, var(--ui-accent) 45%, transparent); }
.ao-frame-sub { font-size: 0.55rem; color: var(--ui-text-tertiary); margin-top: 1px; }
.ao-frame-actions { display: flex; flex-direction: column; gap: 3px; }
.ao-frame-btn { font-family: var(--ui-font-mono, ui-monospace, monospace); font-size: 0.55rem; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--ui-text-secondary); text-align: left; padding: 2px 6px;
  border: 1px solid var(--ui-stroke-secondary); border-radius: 4px; cursor: pointer;
  background: color-mix(in srgb, var(--ui-accent) 6%, transparent); transition: color 0.15s, border-color 0.15s; }
.ao-frame-btn:hover { color: var(--ui-accent); border-color: var(--ui-accent); }
.ao-cap { position: absolute; left: 50%; transform: translateX(-50%); width: 190px; text-align: center;
  font: 500 0.58rem/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ui-text-tertiary); text-shadow: 0 1px 6px rgba(0, 0, 0, 0.9), 0 0 12px rgba(0, 0, 0, 0.6);
  pointer-events: none; z-index: 35;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ao-cap[data-role='you'] { top: -4px; }
.ao-cap[data-role='jarvis'] { top: 55%; bottom: auto; transform: translate(-50%, -50%); color: #d9f6ff;
  font-size: 0.62rem; max-width: 150px; width: 150px;
  text-shadow: 0 0 14px rgba(0, 20, 30, 0.95), 0 1px 4px rgba(0, 0, 0, 0.95), 0 0 22px color-mix(in srgb, var(--ui-accent) 35%, transparent); }
.ao-orb-panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  display: inline-flex; align-items: center; gap: 5px; max-width: 110px; padding: 3px 9px;
  border-radius: 999px; border: 1px solid var(--ui-stroke-secondary);
  background: color-mix(in srgb, var(--ui-card) 85%, transparent);
  font: 500 0.625rem/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ui-text-secondary); white-space: nowrap; cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, .35), 0 0 12px color-mix(in srgb, var(--ui-accent) 14%, transparent);
  will-change: transform, opacity; }
.ao-orb-panel > i { width: 5px; height: 5px; border-radius: 50%; background: var(--ui-accent); flex: none;
  box-shadow: 0 0 6px color-mix(in srgb, var(--ui-accent) 70%, transparent); }
.ao-orb-panel > span { overflow: hidden; text-overflow: ellipsis; }
.ao-orb-panel:hover { border-color: var(--ui-accent); color: var(--ui-text-primary); }

/* --- mobile: no horizontal pan, ever --- */
/* The page scroller must never pan sideways — content wider than the viewport
   is clipped instead of pushing cards off-screen left (the mobile cutoff bug). */
.ao-scrollpage { overflow-x: hidden; }
/* action rows (advisor): when the button group can't fit beside the text it
   wraps to its own right-aligned line instead of squeezing text to a sliver */
.ao-row-actions { margin-left: auto; }
/* advisor row text: guaranteed readable width — if the buttons can't fit
   beside it they wrap below (flex-wrap on the row) instead of crushing the
   alert text to a couple of words per line */
.ao-row-text { flex: 1 1 0; min-width: 16rem; }
@media (max-width: 899px) {
  /* hero: action ribbon first, telemetry wraps under it; hide desktop-only
     mode-number shortcuts so the row fits */
  .ao-hero { flex-wrap: wrap; row-gap: 6px; }
  .ao-hero-meta { order: 2; flex-basis: 100%; flex-wrap: wrap; row-gap: 4px; }
  .ao-hero-actions { order: 1; }
  .ao-mode-sw { display: none; }
  /* action rows: buttons always drop to their own line so text gets full width */
  .ao-row-actions { flex-basis: 100%; justify-content: flex-end; }
}

@media (prefers-reduced-motion: reduce) {
  .ao-in, .ao-led, .ao-skel, .ao-ring, .ao-aurora, .ao-mini-orb { animation: none !important; }
  .ao-bar > i, .ao-tabline, .ao-grid-flip, .ao-card, .ao-body, .ao-collapse { transition: none !important; }
  .ao-frame { animation: none !important; transform: perspective(520px) rotateY(var(--tilt, 0deg)) !important; }
}
`

function StyleOnce() {
  return jsx('style', { dangerouslySetInnerHTML: { __html: CSS } })
}

// ------------------------------------------------------------ primitives

// Every card is collapsible: chevron in the header row toggles the body with a
// smooth grid-rows animation. State persists per card label in localStorage
// (agentos-collapsed), so the dashboard reopens exactly as you left it.
function AoCard({ label, right, className, delay = 0, collapsible = true, children, ...rest }) {
  const ref = useRef(null)
  const persistKey = collapsible && label ? label : null
  const [collMap, setCollMap] = useLocal('agentos-collapsed', {})
  const collapsed = persistKey ? !!collMap[persistKey] : false
  function toggleCollapse() {
    if (!persistKey) return
    haptic('tap')
    setCollMap(m => {
      const n = { ...m }
      if (n[persistKey]) delete n[persistKey]
      else n[persistKey] = true
      return n
    })
  }
  function onMove(e) {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%')
    el.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%')
  }
  const hasHeader = label || right || collapsible
  return jsxs('section', {
    ref,
    onMouseMove: onMove,
    className: cn('ao-card ao-in', className),
    style: { animationDelay: delay + 'ms' },
    ...rest,
    children: [
      jsx('i', { className: 'ao-corner-tl', 'aria-hidden': 'true' }),
      jsx('i', { className: 'ao-corner-br', 'aria-hidden': 'true' }),
      hasHeader && jsxs('div', { className: 'mb-2 flex items-center justify-between gap-2', children: [
        label && jsx('div', { className: 'ao-label', children: label }),
        jsxs('div', { className: 'flex items-center gap-2', children: [
          right,
          collapsible && jsx('button', {
            type: 'button',
            className: 'ao-collapse',
            onClick: toggleCollapse,
            'data-open': collapsed ? '0' : '1',
            'aria-expanded': String(!collapsed),
            title: collapsed ? 'Expand' : 'Collapse',
            children: jsx('span', { 'aria-hidden': 'true', children: '▸' })
          })
        ] })
      ] }),
      jsx('div', { className: 'ao-body', 'data-open': collapsed ? '0' : '1', children:
        jsx('div', { className: 'ao-body-inner', children }) })
    ]
  })
}

// Error boundary so one broken widget never blanks the whole dashboard.
class WidgetBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(e) { return { err: e } }
  render() {
    if (this.state.err) {
      return jsx('div', {
        className: 'ao-card p-3 text-xs',
        style: { color: 'var(--ui-text-tertiary)' },
        children: 'Widget error: ' + String(this.state.err && this.state.err.message || this.state.err)
      })
    }
    return this.props.children
  }
}

function AnimNum({ value, decimals = 0, prefix = '', duration = 900 }) {
  const [n, setN] = useState(0)
  const target = Number(value) || 0
  useEffect(() => {
    let raf, t0
    function step(ts) {
      if (t0 === undefined) t0 = ts
      const p = Math.min(1, (ts - t0) / duration)
      setN(target * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps
  return jsx('span', {
    children: prefix + n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  })
}

function Led({ up }) {
  const color = up === null || up === undefined ? '#d29922' : up ? '#3fb950' : '#f85149'
  return jsx('span', { className: 'ao-led', style: { color } })
}

// ------------------------------------------------------------ brand logos
// Settings rows get an inline brand mark (Simple Icons path data, vendored
// in logos.js — no runtime network). Env-var names map via prefix table;
// anything unmapped falls back to a neutral monogram tile.
const LOGO_KEY_ALIASES = {
  GEMINI_API_KEY: 'googlegemini',
  OPENAI_API_KEY: 'openai',
  ANTHROPIC_API_KEY: 'anthropic',
  OPENROUTER_API_KEY: 'openrouter',
  STRIPE_SECRET_KEY: 'stripe',
  TWILIO_AUTH_TOKEN: 'twilio',
  SENDGRID_API_KEY: 'sendgrid'
}
const LOGO_NAME_ALIASES = {
  'twilio-docs': 'twilio',
  'twilio docs': 'twilio',
  'google calendar': 'googlecalendar',
  'google drive': 'googledrive'
}

function _lum(hex) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return 1
  const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

function logoMarkFor(name) {
  if (!name) return null
  const key = String(name).trim()
  const slug = LOGO_KEY_ALIASES[key] ||
    LOGO_NAME_ALIASES[key.toLowerCase()] ||
    key.toLowerCase().replace(/[^a-z0-9]/g, '')
  const mark = LOGOS[slug]
  if (!mark) return null
  const fill = mark.fill && _lum(mark.fill) >= 0.14 ? mark.fill : 'var(--ui-text-secondary)'
  return { title: mark.title, fill, body: mark.body.replace(/<title>[\s\S]*?<\/title>/, '') }
}

function BrandLogo({ name, size = 15 }) {
  const mark = logoMarkFor(name)
  if (!mark) {
    const letter = (String(name || '').trim()[0] || '?').toUpperCase()
    return jsx('span', {
      className: 'ao-logo-mono', style: { width: size, height: size, fontSize: Math.round(size * 0.58) },
      'aria-hidden': 'true', children: letter
    })
  }
  return jsx('span', {
    className: 'ao-logo', title: mark.title, 'aria-hidden': 'true',
    dangerouslySetInnerHTML: {
      __html: '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
        '" fill="' + mark.fill + '" role="img">' + mark.body + '</svg>'
    }
  })
}

function Skel({ h = '1rem', w = '60%', delay = 0, className }) {
  return jsx('div', { className: cn('ao-skel', className), style: { height: h, width: w, animationDelay: delay + 'ms' } })
}

function RingSpin({ size = 14 }) {
  return jsx('svg', { width: size, height: size, viewBox: '0 0 24 24', className: 'ao-ring inline-block',
    children: jsx('circle', { cx: 12, cy: 12, r: 9, fill: 'none', stroke: 'var(--ui-accent)',
      strokeWidth: 2.5, strokeDasharray: '42 18', strokeLinecap: 'round' }) })
}

function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function FadeIn({ text, className }) {
  return jsx('div', { className, style: { animation: 'aoFadeUp .6s ease both' }, children: text })
}

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function useLocal(key, def) {
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem(key)
      if (s === null) return def
      const val = JSON.parse(s)
      return (val === null || val === undefined) ? def : val
    } catch { return def }
  })
  const ref = useRef(v)
  ref.current = v
  const set = nv => {
    // support both direct values and functional updates (prev => next);
    // only ever persist the computed VALUE — stringify(fn) would store "undefined"
    const val = typeof nv === 'function' ? nv(ref.current) : nv
    ref.current = val
    setV(val)
    try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* storage unavailable */ }
  }
  return [v, set]
}

// Inline sparkline (no deps): normalized polyline of the last N numeric points.
function Spark({ data, up = true, w = 84, h = 22 }) {
  const pts = (data || []).filter(v => typeof v === 'number' && isFinite(v))
  if (pts.length < 2) return jsx('span', { style: { display: 'inline-block', width: w, height: h } })
  const min = Math.min(...pts), max = Math.max(...pts), span = (max - min) || 1
  const step = w / (pts.length - 1)
  const d = pts.map((v, i) =>
    (i === 0 ? 'M' : 'L') + (i * step).toFixed(1) + ',' + (h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)
  ).join(' ')
  return jsx('svg', {
    width: w, height: h, viewBox: '0 0 ' + w + ' ' + h, preserveAspectRatio: 'none',
    className: 'w-full shrink min-w-0', style: { height: h }, 'aria-hidden': 'true',
    children: jsx('path', { d, fill: 'none', stroke: up ? '#3fb950' : '#f85149', strokeWidth: 1.5, strokeLinecap: 'round', opacity: 0.9, vectorEffect: 'non-scaling-stroke' })
  })
}

// HUD chimes — Web Audio, no assets. 'up' on engage, 'down' on settle.
const Chimes = {
  ac: null,
  play(kind) {
    try {
      if (localStorage.getItem('agentos-chimes') === 'off') return
      this.ac = this.ac || new (window.AudioContext || window.webkitAudioContext)()
      if (this.ac.state === 'suspended') this.ac.resume()
      const notes = kind === 'up' ? [660, 990] : kind === 'down' ? [440, 330] : [520]
      notes.forEach((f, i) => {
        const o = this.ac.createOscillator(), g = this.ac.createGain()
        o.type = 'sine'; o.frequency.value = f
        const t0 = this.ac.currentTime + i * 0.09
        g.gain.setValueAtTime(0.0001, t0)
        g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25)
        o.connect(g).connect(this.ac.destination)
        o.start(t0); o.stop(t0 + 0.3)
      })
    } catch { /* audio unavailable — stay silent */ }
  }
}

const AO_THEMES = { cyan: '#5cd6ff', amber: '#ffb84d', emerald: '#3fb950', crimson: '#f5495b', violet: '#a855f7' }

// ------------------------------------------------------------ assistant state bus

const orbClamp01 = v => Math.min(1, Math.max(0, v))
const orbEase = (cur, tgt, k) => cur + (tgt - cur) * k

const ORB_LABELS = {
  idle: 'Voice assistant: idle',
  listening: 'Voice assistant: listening',
  thinking: 'Voice assistant: thinking',
  speaking: 'Voice assistant: speaking',
  working: 'Voice assistant: working'
}

// App-wide assistant state so the orb and the console react from anywhere.
const OrbBus = {
  state: 'idle',
  _mood: 'ok',
  _subs: new Set(),
  _moodSubs: new Set(),
  _level: 0,
  _simRaf: 0,
  _micStream: null,
  _micAc: null,
  _micAnalyser: null,
  _micBuf: null,
  _micRaf: 0,
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn) },
  subscribeMood(fn) { this._moodSubs.add(fn); return () => this._moodSubs.delete(fn) },
  emit() { for (const fn of this._subs) { try { fn(this.state) } catch { /* ignore */ } } },
  emitMood() { for (const fn of this._moodSubs) { try { fn(this._mood) } catch { /* ignore */ } } },
  level() { return this._level },
  mood() { return this._mood },
  setMood(val) {
    if (this._mood === val) return
    this._mood = val
    this.emitMood()
  },
  set(state) {
    if (this.state === state) return
    this.state = state
    this._stopSim()
    if (state === 'speaking') this._simSpeech()
    if (state !== 'listening') this._stopMic()
    this.emit()
  },
  _tickSim(kind, t0) {
    if (this.state !== kind) { this._level = 0; return }
    const t = (performance.now() - t0) / 1000
    if (kind === 'speaking') {
      const phrase = (Math.sin(t * 0.7) + 1) / 2
      const syl = Math.max(0, Math.sin(t * 6.2)) * 0.7 + Math.max(0, Math.sin(t * 9.1 + 1)) * 0.3
      this._level = phrase * syl
    } else {
      const pulse = Math.max(0, Math.sin(t * 3.1)) * 0.45 + Math.max(0, Math.sin(t * 7.7 + 2)) * 0.25
      this._level = pulse
    }
    this._simRaf = requestAnimationFrame(() => this._tickSim(kind, t0))
  },
  _simSpeech() {
    this._tickSim('speaking', performance.now())
  },
  _simListen() {
    this._tickSim('listening', performance.now())
  },
  _stopSim() {
    if (this._simRaf) { cancelAnimationFrame(this._simRaf); this._simRaf = 0 }
    if (this.state !== 'listening' && this.state !== 'speaking') this._level = 0
  },
  async startMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      this._micStream = stream
      const ac = new (window.AudioContext || window.webkitAudioContext)()
      this._micAc = ac
      const analyser = ac.createAnalyser()
      analyser.fftSize = 1024
      this._micBuf = new Float32Array(analyser.fftSize)
      ac.createMediaStreamSource(stream).connect(analyser)
      this._micAnalyser = analyser
      if (ac.state === 'suspended') ac.resume()
      const read = () => {
        if (!this._micAnalyser || this.state !== 'listening') return
        this._micAnalyser.getFloatTimeDomainData(this._micBuf)
        let s = 0
        for (let i = 0; i < this._micBuf.length; i++) s += this._micBuf[i] * this._micBuf[i]
        this._level = orbClamp01((Math.sqrt(s / this._micBuf.length) - 0.008) * 7)
        this._micRaf = requestAnimationFrame(read)
      }
      read()
      return true
    } catch {
      this._simListen()
      return false
    }
  },
  _stopMic() {
    if (this._micRaf) { cancelAnimationFrame(this._micRaf); this._micRaf = 0 }
    if (this._micStream) {
      for (const t of this._micStream.getTracks()) { try { t.stop() } catch { /* ignore */ } }
      this._micStream = null
    }
    if (this._micAc) { try { this._micAc.close() } catch { /* ignore */ } this._micAc = null }
    this._micAnalyser = null
  }
}
if (typeof window !== 'undefined') window.__orbBus = OrbBus

// ------------------------------------------------------------ shared console store
// One source of truth for command history so the Spotlight, the dock and the
// console widget all render (and contribute to) the same conversation.

const ConsoleStore = {
  msgs: [],        // { role: 'you' | 'jarvis', text }
  busy: false,
  current: null,   // the command being executed right now (for the hero ribbon)
  since: 0,        // Date.now() when the current command started
  _subs: new Set(),
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn) },
  emit() { for (const fn of this._subs) { try { fn() } catch { /* ignore */ } } },
  add(m) { this.msgs = [...this.msgs, m]; this.emit() },
  setBusy(b) { this.busy = b; if (!b) this.current = null; this.emit() },
  async send(text) {
    const query = (text || '').trim()
    if (!query || this.busy) return false
    this.add({ role: 'you', text: query })
    this.current = query
    this.since = Date.now()
    this.setBusy(true)
    Tts.ack(ackLineFor(query))
    OrbBus.set(query.startsWith('/') ? 'working' : 'thinking')
    try {
      const r = await REST('/command', { method: 'POST', body: { query } })
      this.add({ role: 'jarvis', text: r.reply })
      this.lastDone = { cmd: query, secs: Math.max(1, Math.round((Date.now() - this.since) / 1000)), at: Date.now() }
      Chimes.play('down')
      const spoke = Tts.speak(r.reply)
      if (!spoke) OrbBus.set('idle')
      return true
    } catch (e) {
      this.add({ role: 'jarvis', text: '[error] ' + ((e && e.message) || 'command failed') })
      OrbBus.set('idle')
      return false
    } finally {
      this.setBusy(false)
    }
  }
}

// Rotating near-instant acknowledgements (backend pre-warms these as edge-tts).
const TTS_ACK_LINES = ['Right away, sir', 'On it, sir', 'At once, sir', 'Working on it now, sir', 'Consider it done, sir']

// Contextual spoken ack: JARVIS answers WHAT he was just asked to do, with a
// rotating variant per action so repeated clicks never sound like a recording.
// Functions take the captured subject (service/contact/sender — original casing
// preserved); plain arrays are subject-less. Returns undefined → caller falls
// back to the rotating generics. Kept regex-first so every ConsoleStore.send
// call site (advisor rows, automation events, galaxy actions, spotlight) gets
// it free.
const ACK_VARIANTS = {
  brief: ['Generating brief now, sir', 'Compiling the brief now, sir', 'Putting the brief together, sir'],
  restart: s => ['Restarting ' + s + ' now, sir', 'Bringing ' + s + ' back up, sir', 'Cycling ' + s + ' for you, sir', 'Kicking ' + s + ' back to life, sir'],
  diagnose: s => ['Digging into ' + s + ', sir', 'Running diagnostics on ' + s + ', sir', 'Investigating ' + s + ' now, sir', 'On the ' + s + ' failure, sir \u2014 pulling the logs'],
  voiceText: w => ['Checking that text from ' + w + ', sir', 'Pulling up the message from ' + w + ', sir', 'Looking at that text from ' + w + ', sir'],
  voiceCall: w => ['Checking that missed call from ' + w + ', sir', 'On that missed call from ' + w + ', sir', 'Pulling the call record for ' + w + ', sir'],
  voicemail: ['Pulling that voicemail for you, sir', 'Fetching the voicemail now, sir', 'Let me play that voicemail back, sir'],
  email: f => ['Opening the message from ' + f + ', sir', 'Pulling up the email from ' + f + ', sir', 'Let me get that message from ' + f + ', sir'],
  inbox: ['Sorting your inbox, sir', 'Triage mode \u2014 clearing the inbox, sir', 'On your mail now, sir'],
  telegram: t => ['Reading the ' + t + ' thread, sir', 'Pulling up the ' + t + ' conversation, sir', 'Opening the ' + t + ' thread now, sir'],
  event: e => ['Pulling up ' + e + ', sir', 'Bringing up ' + e + ' for you, sir', 'Getting ' + e + ' on screen, sir'],
  chart: s => ['Pulling the chart on ' + s + ', sir', 'Bringing up the ' + s + ' tape, sir', 'Running the numbers on ' + s + ', sir'],
  news: s => ['Checking the wires on ' + s + ', sir', 'Scanning the news on ' + s + ', sir', 'Pulling the latest on ' + s + ', sir'],
  delegate: ['Dispatching that to the team, sir', 'Delegating it now, sir', 'Handing that off to the agents, sir'],
  remember: ['Committing that to memory, sir', 'Noted \u2014 I\u2019ll remember that, sir', 'Filing that away, sir'],
  forget: ['Striking that from memory, sir', 'Erasing that record, sir', 'Done \u2014 forgotten, sir'],
  calendar: ['Pulling up your calendar, sir', 'Bringing up the schedule, sir', 'Checking your day, sir'],
  jobs: ['Pulling the job files, sir', 'Bringing up the job board, sir', 'On the jobs now, sir'],
  leads: ["Going through this week's leads, sir", 'Pulling the lead list, sir', 'On the new leads, sir'],
  todos: ['Reviewing your list, sir', 'Pulling up the board, sir', 'Checking your tasks, sir'],
  mode: ['Switching views, sir', 'Changing the view now, sir'],
  diag: ['Running diagnostics now, sir', 'Scanning the system, sir']
}
const _ackI = {} // per-category rotation counters — guarantees no immediate repeat
function pickAck(key) {
  const variants = ACK_VARIANTS[key]
  if (!variants) return undefined
  const lines = typeof variants === 'function' ? variants.apply(null, [].slice.call(arguments, 1)) : variants
  _ackI[key] = ((_ackI[key] || 0) + 1) % lines.length
  return lines[_ackI[key]]
}

function ackLineFor(query) {
  const raw = String(query || '')
  const q = raw.toLowerCase()
  const cap = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s }
  let mm
  if (/(^|\s)\/?brief\b|daily brief/.test(q)) return pickAck('brief')
  if ((mm = raw.match(/restart (?:the )?(?:service )?(.+?)(?:\s+service\b|\s+and\b|\u2014|$|\?)/i))) {
    return pickAck('restart', [mm[1] ? cap(mm[1], 40) : 'it'])
  }
  if ((mm = raw.match(/diagnose(?: why)?(?: the)? (.+?)(?:\s+service\b|\s+is down|$)/i))) {
    return mm[1] ? pickAck('diagnose', [cap(mm[1], 40)]) : pickAck('diag')
  }
  if ((mm = raw.match(/voice had a (.+?) with ([\d\s()+-]{7,25})/i))) {
    const who = cap(mm[2].trim(), 24)
    if (mm[1].toLowerCase().includes('voicem')) return pickAck('voicemail')
    if (mm[1].toLowerCase().includes('missed')) return pickAck('voiceCall', [who])
    return pickAck('voiceText', [who])
  }
  if ((mm = raw.match(/unread email "([^"]+)" from (.+?) in my/i))) {
    return pickAck('email', [cap(mm[2].split('<')[0].trim(), 30)])
  }
  if ((mm = raw.match(/telegram conversation "([^"]+)"/i))) return pickAck('telegram', [cap(mm[1], 40)])
  if ((mm = raw.match(/"(.+)" event/i))) return pickAck('event', [cap(mm[1], 40)])
  if ((mm = raw.match(/analyze ([a-z0-9.\-]+)/i))) return pickAck('chart', [mm[1].toUpperCase()])
  if ((mm = raw.match(/news and outlook for ([a-z0-9.\-]+)/i))) return pickAck('news', [mm[1].toUpperCase()])
  if (/\bdelegate\b/.test(q)) return pickAck('delegate')
  if (/\bremember\b/.test(q)) return pickAck('remember')
  if (/\bforget\b/.test(q)) return pickAck('forget')
  if (/\btriage\b|\binbox\b|\bmail\b/.test(q)) return pickAck('inbox')
  if (/\bcalendar\b/.test(q)) return pickAck('calendar')
  if (/\bjobs\b|\bhub\b/.test(q)) return pickAck('jobs')
  if (/\bleads\b/.test(q)) return pickAck('leads')
  if (/\btodo\b|\btasks\b/.test(q)) return pickAck('todos')
  if (/^\/?mode\b/.test(q)) return pickAck('mode')
  if (/^\/?diag\b/.test(q)) return pickAck('diag')
  return undefined
}

// Cap any spoken text at ~95 words: Fish synthesis wait scales with length
// (~40s for 150 words, ~11s for 85). Trim at a sentence boundary so the cap
// never ends mid-sentence. Mirrors the backend broadcast cap.
function capSpeech(text) {
  let s = String(text).trim()
  if (s.length <= 600) return s
  const cut = s.lastIndexOf('. ', 600)
  s = cut > 200 ? s.slice(0, cut + 1) : s.slice(0, 600)
  s = s.replace(/[ ,;:]+$/, '')
  if (!/[.!?]$/.test(s)) s += '.'
  return s
}

// Text-to-speech pipeline (owned by the store so every surface speaks).
const Tts = {
  supported: typeof window !== 'undefined' && !!window.speechSynthesis,
  _ackI: 0,
  on() {
    try { return localStorage.getItem('agentos-tts') !== 'off' } catch { return true }
  },
  rate() {
    try {
      const n = JSON.parse(localStorage.getItem('agentos-tts-rate'))
      return typeof n === 'number' ? n : 1.05
    } catch { return 1.05 }
  },
  vol() {
    try {
      const n = JSON.parse(localStorage.getItem('agentos-tts-vol'))
      return typeof n === 'number' && n >= 0 && n <= 1 ? n : 1
    } catch { return 1 }
  },
  setVolume(v) {
    const clamped = Math.max(0, Math.min(1, Number(v) || 0))
    try { localStorage.setItem('agentos-tts-vol', JSON.stringify(clamped)) } catch { /* ignore */ }
    if (this._audio) { try { this._audio.volume = clamped } catch { /* ignore */ } }
  },
  // Near-instant verbal acknowledgement ("Generating brief now, sir") for
  // briefs/actions — always the fast pre-warmed edge-tts path, so D hears
  // JARVIS confirm within ~100ms while the real reply synthesizes.
  ack(phrase, voiceOverride) {
    if (!this.on()) return false
    const line = phrase || TTS_ACK_LINES[this._ackI++ % TTS_ACK_LINES.length]
    this.stop()
    try {
      const url = '/api/plugins/agentos/tts?ack=1&text=' + encodeURIComponent(line) +
        (voiceOverride ? '&voice=' + encodeURIComponent(voiceOverride) : '')
      const audio = new Audio(url)
      this._audio = audio
      audio.volume = this.vol()
      audio.play().catch(() => this._fallbackSpeak(line, null))
    } catch { this._fallbackSpeak(line, null) }
    return true
  },
  speak(text, onEnd) {
    if (!this.on()) return false
    const cleaned = String(text)
      .replace(/```[\s\S]*?```/g, ' code block. ')
      .replace(/\*\*|__|`|#+\s?/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    const clean = capSpeech(cleaned)
    this.stop()
    OrbBus.set('speaking')
    this._speakAsync(clean, onEnd)
    return true
  },
  // Neural voice via the backend /tts endpoint (edge-tts, British male);
  // falls back to browser speechSynthesis when the endpoint is missing.
  async _speakAsync(clean, onEnd) {
    const done = () => {
      if (OrbBus.state === 'speaking') OrbBus.set('idle')
      if (onEnd) { try { onEnd() } catch { /* ignore */ } }
    }
    try {
      // Streaming GET: the browser's audio element buffers and starts playing
      // as edge-tts chunks arrive — first sound well under a second.
      const url = '/api/plugins/agentos/tts?text=' + encodeURIComponent(clean)
      const audio = new Audio(url)
      audio.volume = this.vol()
      this._audio = audio
      audio.onended = done
      audio.onerror = () => this._fallbackSpeak(clean, done)
      await audio.play()
      return
    } catch { /* endpoint unavailable — use the browser voice */ }
    this._fallbackSpeak(clean, done)
  },
  _fallbackSpeak(clean, done) {
    if (!this.supported) { if (done) done(); return }
    try {
      const u = new SpeechSynthesisUtterance(clean)
      u.rate = this.rate()
      u.volume = this.vol()
      u.onend = done
      u.onerror = done
      window.speechSynthesis.speak(u)
    } catch { if (done) done() }
  },
  stop() {
    try { if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel() } catch { /* ignore */ }
    if (this._audio) { try { this._audio.pause(); this._audio.removeAttribute('src') } catch { /* ignore */ } this._audio = null }
    if (this._audioUrl) { try { URL.revokeObjectURL(this._audioUrl) } catch { /* ignore */ } this._audioUrl = null }
  }
}

// Cross-component command surface: spotlight, dock, hero and vision all share it.
const JarvisCtl = {
  send: t => ConsoleStore.send(t),
  toggleVoice: null,
  openSpotlight: null,
  canVoice: false
}

// ------------------------------------------------------------ NeuralCore orb
// jarvis-deck orb v2: plasma core + neural network combo.
//   Layer 1 — plasma core: single quad, fragment shader fakes a 3D sphere
//             (sphere-surface normal from the pixel), fbm convection bands
//             drifting across it, white-hot center, fresnel rim burn, corona.
//   Layer 2 — neural net: fibonacci-sphere neuron shell + always-on edges
//             with signal pulses traveling along them; density and pulse
//             speed driven by the assistant state (speaking = fully lit
//             fast network, idle = dim slow web).
// Raw-WebGL, hand-rolled (plugin SDK heritage — no three.js at runtime).
// Perf budget: dpr capped 1.25, render scale 0.8, frame paused offscreen.

const NC_CORE_VERT = `precision highp float;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`

const NC_CORE_FRAG = `precision highp float;
uniform float iTime;
uniform float uEnergy;
uniform float uLevel;
uniform vec3 uCol1;
varying vec2 vUv;
float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash(i);
  float n100 = hash(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    v += a * vnoise(p);
    p = p * 2.05 + vec3(1.7);
    a *= 0.55;
  }
  return v;
}
void main() {
  vec2 uv = (vUv - 0.5) * 2.0;
  float r = length(uv);
  float R = 0.52;
  if (r > R * 1.45) { gl_FragColor = vec4(0.0); return; }
  float t = iTime;
  // fake-3D: sphere surface point + normal from the pixel position
  float z = sqrt(max(R * R - r * r, 0.0));
  vec3 n = normalize(vec3(uv, z));
  // convection: turbulence bands drift across the surface
  float turb = fbm(n * 2.3 + vec3(0.0, t * 0.38, t * 0.24));
  float cells = fbm(n * 4.6 + vec3(turb * 1.6 - t * 0.55, t * 0.2, 0.0));
  float heat = 0.42 + 0.38 * uEnergy + 0.3 * uLevel + 0.14 * sin(t * 2.1 + turb * 7.0);
  float limb = smoothstep(R * 1.05, R * 0.3, r);
  float rim = pow(smoothstep(R * 0.7, R * 1.02, r), 2.0) * (0.7 + 0.7 * uEnergy);
  float centerGlow = pow(max(1.0 - r / R, 0.0), 3.0);
  vec3 col = mix(uCol1 * 0.1, uCol1, clamp(pow(cells, 1.6) * 2.1, 0.0, 1.0));
  col = mix(col, vec3(1.0), clamp(heat * 0.42 + centerGlow * 0.8, 0.0, 1.0));
  col += uCol1 * rim * 0.9;
  float halo = exp(-max(r - R, 0.0) * 9.0) * (0.22 + 0.3 * uEnergy);
  float a = limb * (0.5 + 0.5 * heat) * (0.45 + 0.55 * cells) + halo;
  gl_FragColor = vec4(col * a, a);
}`

// Neuron shell points: wave-displaced fibonacci sphere + filament rings +
// radial energy streams (proven layer, carried over from the v1 orb).
const NC_VERT = `precision highp float;
attribute vec3 position;
attribute float seed;
uniform float iTime;
uniform vec2 iRes;
uniform float uEnergy;
uniform float uLevel;
uniform highp float uPlex;
varying float vBright;
varying float vSeed;
varying float vHot;
void main() {
  float t = iTime;
  float w = sin(position.y * 3.1 + t * 0.6 + seed * 6.283) * 0.5
          + sin(position.x * 4.2 - t * 0.45 + seed * 3.1) * 0.3
          + sin(position.z * 2.4 + t * 0.3) * 0.4;
  float amp = 0.05 + 0.09 * uEnergy + 0.14 * uLevel;
  vec3 p = position * (1.0 + w * amp) * (1.0 + 0.22 * uPlex);
  float a = t * 0.12 + 0.6;
  float ca = cos(a), sa = sin(a);
  p = vec3(p.x * ca + p.z * sa, p.y, -p.x * sa + p.z * ca);
  float tilt = 0.0;
  float ct = cos(tilt), stl = sin(tilt);
  p = vec3(p.x, p.y * ct - p.z * stl, p.y * stl + p.z * ct);
  float zv = p.z + 2.7;
  float aspect = iRes.x / max(iRes.y, 1.0);
  vec2 ndc = vec2(p.x * 1.55 / (zv * aspect), p.y * 1.55 / zv);
  gl_Position = vec4(ndc, 0.0, 1.0);
  float rim = pow(1.0 - abs(p.z) / max(length(p), 0.001), 1.5);
  float hot = pow(max(p.z / max(length(p), 0.001), 0.0), 2.0);
  float near = clamp((zv - 1.4) / 2.6, 0.0, 1.0);
  vBright = (0.1 + 1.15 * seed * seed) * (0.7 + 0.6 * uEnergy + 0.8 * uLevel)
          * (0.6 + 0.4 * near) * (1.0 + 0.7 * rim) * (0.85 + 0.55 * hot)
          * (1.0 - 0.5 * uPlex);
  vSeed = seed;
  vHot = hot;
  gl_PointSize = (1.5 + 3.4 * seed + 1.3 * uEnergy + 1.6 * uLevel) * (iRes.y / 700.0);
}`

const NC_FRAG = `precision highp float;
uniform vec3 uCol1;
uniform vec3 uCol2;
varying float vBright;
varying float vSeed;
varying float vHot;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.08, d);
  vec3 col = mix(uCol2, uCol1, clamp(vSeed * 1.4, 0.0, 1.0));
  col = mix(col, vec3(1.0), vHot * 0.55);
  float b = vBright * a;
  gl_FragColor = vec4(col * b, b);
}`

// Neural edges: nearby neurons connect with filaments; signal pulses travel
// along each edge (per-edge phase offset), heating to white at the head.
const NC_LINE_VERT = `precision highp float;
attribute vec3 position;
attribute float seed;
attribute float t01;
attribute float phase;
uniform float iTime;
uniform vec2 iRes;
uniform float uEnergy;
uniform highp float uPlex;
varying float vSeed;
varying float vT01;
varying float vPhase;
void main() {
  float t = iTime;
  float w = sin(position.y * 3.1 + t * 0.6 + seed * 6.283) * 0.5
          + sin(position.x * 4.2 - t * 0.45 + seed * 3.1) * 0.3
          + sin(position.z * 2.4 + t * 0.3) * 0.4;
  float amp = 0.05 + 0.09 * uEnergy;
  vec3 p = position * (1.0 + w * amp) * (1.0 + 0.22 * uPlex);
  float a = t * 0.12 + 0.6;
  float ca = cos(a), sa = sin(a);
  p = vec3(p.x * ca + p.z * sa, p.y, -p.x * sa + p.z * ca);
  float tilt = 0.0;
  p = vec3(p.x, p.y * cos(tilt) - p.z * sin(tilt), p.y * sin(tilt) + p.z * cos(tilt));
  float zv = p.z + 2.7;
  float aspect = iRes.x / max(iRes.y, 1.0);
  gl_Position = vec4(p.x * 1.55 / (zv * aspect), p.y * 1.55 / zv, 0.0, 1.0);
  vSeed = seed;
  vT01 = t01;
  vPhase = phase;
}`
const NC_LINE_FRAG = `precision highp float;
uniform float iTime;
uniform vec3 uCol1;
uniform float uEnergy;
uniform float uLevel;
uniform highp float uPlex;
varying float vSeed;
varying float vT01;
varying float vPhase;
void main() {
  float speed = 0.22 + 0.85 * uEnergy;
  float sp = fract(vT01 - iTime * speed + vPhase);
  float head = sp < 0.18 ? (1.0 - sp / 0.18) : 0.0;
  head = head * head;
  float b = (0.24 + 0.52 * vSeed) * uPlex + head * (0.6 + 0.7 * uLevel + 0.4 * uEnergy);
  vec3 col = mix(uCol1, vec3(1.0), 0.25 + 0.55 * head);
  gl_FragColor = vec4(col * b, b);
}`

function cssColorToRgb(v) {
  if (!v) return null
  let m = String(v).trim().match(/^#([0-9a-f]{6})$/i)
  if (m) {
    const n = parseInt(m[1], 16)
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
  }
  m = String(v).match(/rgba?\(([^)]+)\)/)
  if (m) {
    const p = m[1].split(',').map(Number)
    if (p.length >= 3) return [p[0] / 255, p[1] / 255, p[2] / 255]
  }
  return null
}

// Orb3D is the public name (hero/HUD reference it); it renders NeuralCore.
function Orb3D({ size = 220, onClick, ariaLabel }) {
  const rootRef = useRef(null)
  const cvRef = useRef(null)
  const [accent, setAccent] = useState('#5cd6ff')
  useEffect(() => {
    try {
      const probe = document.querySelector('.ao-card') || document.body
      const v = getComputedStyle(probe).getPropertyValue('--ui-accent').trim()
      if (v) setAccent(v)
    } catch { /* keep fallback */ }
  }, [])
  const colorRef = useRef(null)
  colorRef.current = cssColorToRgb(accent) || [0.36, 0.84, 1]

  useEffect(() => {
    const root = rootRef.current
    const cv = cvRef.current
    if (!root || !cv) return undefined
    let gl = null
    try {
      gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false })
    } catch (e) { console.warn('[jarvis-deck] orb: webgl getContext threw', e) }
    if (!gl) return undefined // CSS fallback layer below still renders a glowing orb
    function sh(type, src) {
      const s = gl.createShader(type)
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('[jarvis-deck] orb: shader compile failed:', gl.getShaderInfoLog(s))
        gl.deleteShader(s)
        return null
      }
      return s
    }
    function link(vs, fs, tag) {
      const p = gl.createProgram()
      gl.attachShader(p, vs)
      gl.attachShader(p, fs)
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.warn('[jarvis-deck] orb:', tag, 'link failed:', gl.getProgramInfoLog(p))
        return null
      }
      return p
    }

    // --- plasma core quad program
    const coreVs = sh(gl.VERTEX_SHADER, NC_CORE_VERT)
    const coreFs = sh(gl.FRAGMENT_SHADER, NC_CORE_FRAG)
    const coreProg = coreVs && coreFs ? link(coreVs, coreFs, 'core') : null
    const UC = coreProg ? {} : null
    if (UC) for (const n of ['iTime', 'uEnergy', 'uLevel', 'uCol1']) UC[n] = gl.getUniformLocation(coreProg, n)
    const quadBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const coreLocPos = coreProg ? gl.getAttribLocation(coreProg, 'position') : -1
    const bindCoreAttrs = () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
      gl.enableVertexAttribArray(coreLocPos)
      gl.vertexAttribPointer(coreLocPos, 2, gl.FLOAT, false, 8, 0)
    }

    // --- neuron shell point program + geometry
    const vs = sh(gl.VERTEX_SHADER, NC_VERT)
    const fs = sh(gl.FRAGMENT_SHADER, NC_FRAG)
    if (!vs || !fs) return undefined
    const prog = link(vs, fs, 'points')
    if (!prog) return undefined
    const verts = (() => {
      const pts = []
      const N = 4800
      const golden = Math.PI * (3 - Math.sqrt(5))
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2
        const r = Math.sqrt(Math.max(0, 1 - y * y))
        const th = golden * i
        pts.push(Math.cos(th) * r, y, Math.sin(th) * r, Math.random())
      }
      for (const ring of [{ tilt: 0.5, rad: 1.22 }, { tilt: -0.85, rad: 1.34 }, { tilt: 1.7, rad: 1.15 }]) {
        const M = 220
        for (let i = 0; i < M; i++) {
          const a2 = i / M * Math.PI * 2
          const x = Math.cos(a2) * ring.rad
          const z0 = Math.sin(a2) * ring.rad
          const y1 = -z0 * Math.sin(ring.tilt)
          const z1 = z0 * Math.cos(ring.tilt)
          pts.push(x, y1, z1, Math.random())
        }
      }
      // radial energy streams in antipodal pairs — burst stays centered
      for (let f = 0; f < 13; f++) {
        const yf = 1 - (f / 12) * 2
        const rf = Math.sqrt(Math.max(0, 1 - yf * yf))
        const thf = f * 2.399963
        const dx = Math.cos(thf) * rf, dy = yf, dz = Math.sin(thf) * rf
        for (const dir of [[dx, dy, dz], [-dx, -dy, -dz]]) {
          for (let i = 0; i < 34; i++) {
            const rr = 0.18 + (i / 34) * 1.3 + (Math.random() - 0.5) * 0.07
            pts.push(dir[0] * rr, dir[1] * rr, dir[2] * rr, Math.random())
          }
        }
      }
      return new Float32Array(pts)
    })()
    const ptCount = verts.length / 4
    const ptBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, ptBuf)
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW)
    const stride = 16
    const locPos = gl.getAttribLocation(prog, 'position')
    gl.enableVertexAttribArray(locPos)
    gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, stride, 0)
    const locSeed = gl.getAttribLocation(prog, 'seed')
    gl.enableVertexAttribArray(locSeed)
    gl.vertexAttribPointer(locSeed, 1, gl.FLOAT, false, stride, 12)
    const U = {}
    for (const n of ['iTime', 'iRes', 'uCol1', 'uCol2', 'uLevel', 'uEnergy', 'uPlex']) U[n] = gl.getUniformLocation(prog, n)

    // --- neural edge program + geometry (per-vertex: xyz, seed, t01, phase)
    let lineProg = null, UL = null, lineBuf = null, lineCount = 0
    const lvs = sh(gl.VERTEX_SHADER, NC_LINE_VERT)
    const lfs = sh(gl.FRAGMENT_SHADER, NC_LINE_FRAG)
    if (!lvs || !lfs) console.warn('[jarvis-deck] orb: edge shader compile failed')
    if (lvs && lfs) {
      lineProg = link(lvs, lfs, 'edges')
      if (lineProg) {
        UL = {}
        for (const n of ['iTime', 'iRes', 'uCol1', 'uEnergy', 'uLevel', 'uPlex']) UL[n] = gl.getUniformLocation(lineProg, n)
        const segs = []
        let tries = 0
        const strideL = 6
        while (segs.length < 700 * strideL * 2 && tries < 90000) {
          tries++
          const i = (Math.random() * 4800 | 0) * 4
          const j = (Math.random() * 4800 | 0) * 4
          const dx = verts[i] - verts[j], dy = verts[i + 1] - verts[j + 1], dz = verts[i + 2] - verts[j + 2]
          if (dx * dx + dy * dy + dz * dz > 0.3) continue
          const ph = Math.random() * 6.283
          segs.push(verts[i], verts[i + 1], verts[i + 2], verts[i + 3], 0, ph,
            verts[j], verts[j + 1], verts[j + 2], verts[j + 3], 1, ph)
        }
        const lineVerts = new Float32Array(segs)
        lineCount = lineVerts.length / strideL
        lineBuf = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf)
        gl.bufferData(gl.ARRAY_BUFFER, lineVerts, gl.STATIC_DRAW)
      }
    }
    const bindLineAttrs = () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf)
      const la = gl.getAttribLocation(lineProg, 'position')
      const lb = gl.getAttribLocation(lineProg, 'seed')
      const lc = gl.getAttribLocation(lineProg, 't01')
      const ld = gl.getAttribLocation(lineProg, 'phase')
      gl.enableVertexAttribArray(la)
      gl.vertexAttribPointer(la, 3, gl.FLOAT, false, 24, 0)
      gl.enableVertexAttribArray(lb)
      gl.vertexAttribPointer(lb, 1, gl.FLOAT, false, 24, 12)
      gl.enableVertexAttribArray(lc)
      gl.vertexAttribPointer(lc, 1, gl.FLOAT, false, 24, 16)
      gl.enableVertexAttribArray(ld)
      gl.vertexAttribPointer(ld, 1, gl.FLOAT, false, 24, 20)
    }
    const bindPointAttrs = () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, ptBuf)
      gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 16, 0)
      gl.vertexAttribPointer(locSeed, 1, gl.FLOAT, false, 16, 12)
    }

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    let raf = 0, visible = true, last = 0, time = 0, energyS = 0, levelS = 0, plexS = 0.55
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25)
      const r = root.getBoundingClientRect()
      const w = Math.max(1, Math.round(r.width * 0.8))
      const h = Math.max(1, Math.round(r.height * 0.8))
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      gl.viewport(0, 0, cv.width, cv.height)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(root)
    const io = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting
      if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(frame) }
    })
    io.observe(cv)
    resize()

    function frame(now) {
      raf = 0
      if (!visible) return
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016)
      last = now
      time += dt * (reduce.matches ? 0.35 : 1)
      const st = OrbBus.state
      const rawLvl = orbClamp01(OrbBus.level())
      levelS = orbEase(levelS, rawLvl, rawLvl > levelS ? 1 - Math.exp(-dt * 22) : 1 - Math.exp(-dt * 6))
      const energy = st === 'thinking' || st === 'working' ? 0.85 : st === 'listening' ? 0.45 + levelS * 0.55
        : st === 'speaking' ? 0.3 + levelS * 0.7 : 0.08 + 0.04 * Math.sin(time * 0.9)
      energyS = orbEase(energyS, energy, 1 - Math.exp(-dt * 5))
      // neural net density: dim slow web at idle, fully lit while speaking
      const plexTarget = st === 'speaking' ? 1.0 : st === 'thinking' || st === 'working' ? 0.8 : st === 'listening' ? 0.7 : 0.55
      plexS = orbEase(plexS, plexTarget, 1 - Math.exp(-dt * 4))
      let base = colorRef.current || [0.36, 0.84, 1]
      const mVal = OrbBus.mood()
      if (st === 'listening') base = [1.0, 0.32, 0.3] // red core while listening
      else if (st === 'thinking' || st === 'working' || st === 'speaking') base = [0.66, 0.33, 0.97] // violet active
      else if (mVal === 'alert') base = [0.96, 0.29, 0.36] // crimson mood alert
      else if (mVal === 'degraded') base = [1.0, 0.72, 0.30] // amber mood degraded
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      // layer 1: plasma core
      if (coreProg) {
        gl.useProgram(coreProg)
        bindCoreAttrs()
        gl.uniform1f(UC.iTime, time)
        gl.uniform1f(UC.uEnergy, energyS)
        gl.uniform1f(UC.uLevel, levelS)
        gl.uniform3f(UC.uCol1, base[0], base[1], base[2])
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }
      // layer 2: neural edges (always on — density/pulse driven by state)
      if (lineProg && lineCount > 0) {
        gl.useProgram(lineProg)
        bindLineAttrs()
        gl.uniform1f(UL.iTime, time)
        gl.uniform2f(UL.iRes, cv.width, cv.height)
        gl.uniform3f(UL.uCol1, base[0], base[1], base[2])
        gl.uniform1f(UL.uEnergy, energyS)
        gl.uniform1f(UL.uLevel, levelS)
        gl.uniform1f(UL.uPlex, plexS)
        gl.drawArrays(gl.LINES, 0, lineCount)
      }
      // layer 3: neuron shell points
      gl.useProgram(prog)
      bindPointAttrs()
      gl.uniform1f(U.iTime, time)
      gl.uniform2f(U.iRes, cv.width, cv.height)
      gl.uniform3f(U.uCol1, base[0], base[1], base[2])
      gl.uniform3f(U.uCol2, base[0] * 0.25, base[1] * 0.3, base[2] * 0.55 + 0.12)
      gl.uniform1f(U.uLevel, levelS)
      gl.uniform1f(U.uEnergy, energyS)
      gl.uniform1f(U.uPlex, plexS)
      gl.drawArrays(gl.POINTS, 0, ptCount)
      raf = requestAnimationFrame(frame)
    }
    last = performance.now()
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      // deliberately NOT loseContext(): getContext() on this canvas afterwards
      // returns the same dead context, which blanks the orb on every re-render
    }
  }, [])

  return jsxs('div', {
    ref: rootRef,
    role: onClick ? 'button' : 'status',
    'aria-label': ariaLabel || 'Jarvis orb',
    onClick,
    title: onClick ? 'Click to talk' : undefined,
    style: {
      position: 'relative', flex: 'none',
      width: typeof size === 'number' ? size + 'px' : size, aspectRatio: '1',
      maxWidth: '100%', cursor: onClick ? 'pointer' : 'default'
    },
    children: [
      // CSS fallback glow behind the canvas (also visible while WebGL loads)
      jsx('div', {
        'aria-hidden': 'true',
        style: {
          position: 'absolute', inset: '12%', borderRadius: '50%',
          background: 'radial-gradient(circle at 38% 32%, color-mix(in srgb, var(--ui-accent) 55%, transparent), color-mix(in srgb, var(--ui-accent) 16%, transparent) 58%, transparent 75%)',
          filter: 'blur(10px)', animation: 'aoBreathe 3.4s ease-in-out infinite'
        }
      }),
      jsx('canvas', {
        ref: cvRef, 'aria-hidden': 'true',
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }
      }),
      jsx(OrbHud, {})
    ]
  })
}


const ORB_STATE_COLORS = {
  idle: 'var(--ui-text-tertiary)',
  listening: '#f85149',
  thinking: 'var(--ui-accent)',
  speaking: 'var(--ui-accent)',
  working: '#a855f7'
}

// ------------------------------------------------------------ orb HUD rings
// 2D ring layer over the orb (segmented arcs, tick ring, dashed inner ring),
// driven by assistant state: dim + slow drift when idle, red while listening,
// fast sweep while thinking, pulsing with voice level while speaking.

function OrbHud() {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return undefined
    const ctx = cv.getContext('2d')
    if (!ctx) return undefined
    let raf = 0
    const t0 = performance.now()
    let level = 0
    let st = OrbBus.state
    let md = OrbBus.mood()
    const unsub = OrbBus.subscribe(s => { st = s })
    const unsubMood = OrbBus.subscribeMood(m => { md = m })
    let accent = '#5cd6ff'
    const readAccent = () => {
      try {
        const probe = document.querySelector('.ao-card') || document.body
        const v = getComputedStyle(probe).getPropertyValue('--ui-accent').trim()
        if (v) accent = v
      } catch { /* keep fallback */ }
    }
    const moodColor = () => {
      if (md === 'alert') return '#f5495b'
      if (md === 'degraded') return '#ffb84d'
      return null // use state-based color
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    let w = 0, h = 0
    const resize = () => {
      const r = cv.getBoundingClientRect()
      w = Math.max(1, Math.round(r.width * dpr))
      h = Math.max(1, Math.round(r.height * dpr))
      cv.width = w
      cv.height = h
      readAccent()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(cv)
    resize()
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    function arc(r, start, len, width, color) {
      ctx.beginPath()
      ctx.arc(w / 2, h / 2, r, start, start + len)
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.lineCap = 'round'
      ctx.stroke()
    }
    function frame(now) {
      raf = 0
      const t = (now - t0) / 1000
      const target = orbClamp01(OrbBus.level())
      level += (target - level) * 0.2
      ctx.clearRect(0, 0, w, h)
      const R = Math.min(w, h) / 2
      if (R < 10) { raf = requestAnimationFrame(frame); return }
      const listening = st === 'listening'
      const speaking = st === 'speaking'
      const busy = st === 'thinking' || st === 'working' || speaking
      // Mood overrides state color for the ring tint; state drives motion intensity
      const moodOverride = moodColor()
      let col
      if (moodOverride) col = moodOverride
      else if (listening) col = '#f85149'
      else if (st === 'thinking' || st === 'working') col = '#a855f7'
      else if (speaking) col = '#a855f7'
      else col = accent
      const speed = reduce.matches ? 0 : listening ? 1.0 : busy ? 0.55 : 0.12
      const base = listening ? 0.9 : busy ? 0.8 : 0.55
      const CX = w / 2, CY = h / 2

      // dim full-circle track for the state arc
      ctx.globalAlpha = base * 0.25
      arc(R * 0.86, 0, Math.PI * 2, 1, col)

      // the state arc itself
      if (st === 'thinking' || st === 'working') {
        // comet sweep: bright head with a short decaying tail
        const head = t * speed * 2.2
        ctx.globalAlpha = base * 0.35
        arc(R * 0.86, head - Math.PI * 0.55, Math.PI * 0.55, 1.5, col)
        ctx.globalAlpha = base
        arc(R * 0.86, head, 0.14, 2.5, col)
      } else if (listening || speaking) {
        // voice-driven fill from 12 o'clock
        ctx.globalAlpha = base
        arc(R * 0.86, -Math.PI / 2, Math.PI * 2 * Math.max(0.06, level * 0.94), 2 + level * 1.5, col)
      } else {
        // idle: slow breathing segment (frozen at mid-point under reduced motion)
        const breathe = reduce.matches ? 0.5 : 0.5 + 0.5 * Math.sin(t * 0.9)
        ctx.globalAlpha = base * (0.45 + 0.35 * breathe)
        arc(R * 0.86, t * speed * 1.2, (Math.PI / 3) * (0.6 + 0.4 * breathe), 1.5, col)
      }

      // instrument tick ring: 72 fine ticks, slow counter-drift, level-reactive
      ctx.globalAlpha = base * 0.6
      ctx.strokeStyle = col
      ctx.lineWidth = 1
      ctx.beginPath()
      const ticks = 72
      const tr = R * 0.78
      const ta = -t * speed * 0.4
      for (let i = 0; i < ticks; i++) {
        const a = ta + i * (Math.PI * 2 / ticks)
        const l = (i % 6 === 0 ? 6 : 3) + level * (busy ? 4 : 2)
        ctx.moveTo(CX + Math.cos(a) * (tr - l), CY + Math.sin(a) * (tr - l))
        ctx.lineTo(CX + Math.cos(a) * tr, CY + Math.sin(a) * tr)
      }
      ctx.stroke()

      // compass readouts at the cardinals — instrument-panel depth cue
      ctx.globalAlpha = base * 0.55
      ctx.fillStyle = col
      ctx.font = Math.max(8, Math.round(R * 0.065)) + 'px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const marks = ['000', '090', '180', '270']
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 2
        ctx.fillText(marks[i], CX + Math.cos(a) * R * 0.97, CY + Math.sin(a) * R * 0.97)
      }

      // core reticle: 4 crosshair ticks + center dot; breathes with voice
      const ret = R * (0.3 + (speaking || listening ? level * 0.05 : 0))
      ctx.globalAlpha = base * 0.55
      ctx.beginPath()
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2
        ctx.moveTo(CX + Math.cos(a) * (ret - 5), CY + Math.sin(a) * (ret - 5))
        ctx.lineTo(CX + Math.cos(a) * ret, CY + Math.sin(a) * ret)
      }
      ctx.stroke()
      ctx.globalAlpha = base * 0.8
      ctx.fillRect(CX - 1, CY - 1, 2, 2)
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      unsub()
      unsubMood()
    }
  }, [])
  return jsx('canvas', { ref, className: 'ao-orb-hud', 'aria-hidden': 'true' })
}

// ------------------------------------------------------------ orb panels
// Small frames orbiting the orb: tools, connectors, quick actions. Click
// routes to the app (openExternal) or fires the command through JARVIS.

// Live captions around the orb (reference behavior): your last words render
// above the orb, JARVIS's reply below — the conversation IS the visualization.
function OrbCaptions() {
  const [, force] = useState(0)
  useEffect(() => ConsoleStore.subscribe(() => force(v => v + 1)), [])
  const msgs = ConsoleStore.msgs
  const last = role => {
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === role) return msgs[i].text
    return null
  }
  const clip = s => (s.length > 110 ? s.slice(0, 108).trimEnd() + '…' : s)
  const you = last('you')
  const jarvis = last('jarvis')
  return jsxs(Fragment, { children: [
    you && jsx('div', { className: 'ao-cap', 'data-role': 'you', children: clip(you) }),
    jarvis && jsx('div', { className: 'ao-cap', 'data-role': 'jarvis', children: clip(jarvis) })
  ] })
}

// Four floating glass HUD frames around the orb (reference: holographic core
// flanked by rectangular screens). Two per side, tilted toward the orb, gently
// floating. Left pair = live system metrics; right pair = revenue + actions.
function OrbFrames({ svcs, up, open, rev, onOpenSpotlight }) {
  const frame = (cls, label, content, delay) => jsx('div', {
    className: 'ao-frame ' + cls,
    style: { animationDelay: delay },
    children: [
      jsxs('div', { className: 'ao-frame-head', children: [
        jsx('i', {}),
        jsx('span', { children: label })
      ] }),
      content
    ]
  })
  const act = (label, fn, title) => jsx('button', {
    type: 'button',
    className: 'ao-frame-btn',
    title,
    onClick: e => {
      e.stopPropagation()
      haptic('tap')
      Chimes.play('up')
      fn()
    },
    children: label
  })
  return jsx('div', { className: 'pointer-events-none absolute inset-0 z-20', children: [
    frame('ao-fr-lt', 'core telemetry', jsxs('div', { className: 'ao-frame-body', children: [
      jsx('div', { className: 'ao-frame-num', children: svcs.length ? up + '/' + svcs.length : '—' }),
      jsx('div', { className: 'ao-frame-sub', children: 'services online' })
    ] }), '0s'),
    frame('ao-fr-lb', 'directives', jsxs('div', { className: 'ao-frame-body', children: [
      jsx('div', { className: 'ao-frame-num', children: jsx(AnimNum, { value: open }) }),
      jsx('div', { className: 'ao-frame-sub', children: 'open tasks' })
    ] }), '-2.1s'),
    frame('ao-fr-rt', 'revenue', jsxs('div', { className: 'ao-frame-body', children: [
      jsx('div', { className: 'ao-frame-num', children: rev == null ? '—' : jsx(AnimNum, { value: rev, prefix: '$' }) }),
      jsx('div', { className: 'ao-frame-sub', children: 'month to date' })
    ] }), '-1.2s'),
    frame('ao-fr-rb', 'actions', jsxs('div', { className: 'ao-frame-actions', children: [
      act('brief', async () => {
        // fast path: today's brief is usually generated + its speech script
        // cached — speak it immediately. Only fall back to a full agent
        // session when no brief exists yet (broadcast 409s).
        try {
          const r = await REST('/brief/broadcast', { method: 'POST', body: {}, timeoutMs: 120000 })
          ConsoleStore.add({ role: 'jarvis', text: r.speech })
          Tts.speak(r.speech)
        } catch {
          JarvisCtl.send('Generate my daily brief')
        }
      }, 'Run the daily brief'),
      act('top 3', () => JarvisCtl.send('What are my top 3 actions today?'), "Today's top 3 actions"),
      act('console', onOpenSpotlight, 'Open the command runner (Ctrl+J)')
    ] }), '-3.2s')
  ] })
}

// ------------------------------------------------------------ data cards

function BriefCard() {
  const qc = useQueryClient()
  const now = useNow()
  const briefQ = useQuery({
    queryKey: ['agentos', 'brief'],
    queryFn: () => REST('/brief/today')
  })
  const [genState, setGenState] = useState(null) // null | 'running' | error string
  const [runState, setRunState] = useState(null) // null | 'preparing' | error string
  const [runRes, setRunRes] = useState(null)     // { speech, followUps }
  const [speakingNow, setSpeakingNow] = useState(false)

  async function generate() {
    setGenState('running')
    haptic('tap')
    Tts.ack('Generating brief now, sir')
    try {
      await REST('/brief/generate', { method: 'POST', body: {}, timeoutMs: 480000 })
      setGenState(null)
      qc.invalidateQueries({ queryKey: ['agentos', 'brief'] })
    } catch (e) {
      setGenState(String((e && e.message) || e).slice(0, 300))
    }
  }

  // Run Daily Brief: JARVIS reads today's brief aloud, then proposes follow-up
  // commands D can fire with one click. Generates the brief first if missing.
  async function runBrief() {
    haptic('tap')
    Chimes.play('up')
    Tts.ack(brief ? 'Right away, sir' : 'Generating brief now, sir')
    setRunRes(null)
    setRunState('preparing')
    try {
      if (!brief) {
        await REST('/brief/generate', { method: 'POST', body: {}, timeoutMs: 480000 })
        qc.invalidateQueries({ queryKey: ['agentos', 'brief'] })
      }
      const r = await REST('/brief/broadcast', { method: 'POST', body: {}, timeoutMs: 120000 })
      setRunRes(r)
      setRunState(null)
      const spoke = Tts.speak(r.speech, () => setSpeakingNow(false))
      setSpeakingNow(!!spoke)
    } catch (e) {
      setRunState(String((e && e.message) || e).slice(0, 300))
    }
  }

  function stopSpeech() {
    Tts.stop()
    setSpeakingNow(false)
    if (OrbBus.state === 'speaking') OrbBus.set('idle')
  }

  const brief = briefQ.data && briefQ.data.brief
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saveState, setSaveState] = useState(null) // null | 'saving' | 'saved' | error string

  function startEdit() {
    setDraft(brief || '')
    setSaveState(null)
    setEditing(true)
  }
  async function saveEdit() {
    setSaveState('saving')
    try {
      await REST('/brief/save', { method: 'POST', body: { brief: draft }, timeoutMs: 30000 })
      setSaveState('saved')
      setEditing(false)
      qc.invalidateQueries({ queryKey: ['agentos', 'brief'] })
    } catch (e) {
      setSaveState(String((e && e.message) || e).slice(0, 200))
    }
  }

  return jsx(AoCard, {
    label: 'daily brief',
    delay: 60,
    right: jsxs('div', { className: 'flex items-center gap-3', children: [
      jsx('button', {
        type: 'button',
        className: 'text-xs text-(--ui-accent)',
        onClick: runBrief,
        children: runState === 'preparing' ? 'Preparing…' : 'Run Daily Brief'
      }),
      jsx('button', {
        type: 'button',
        className: 'text-xs text-(--ui-accent)',
        onClick: generate,
        children: genState === 'running' ? 'Generating…' : brief ? 'Regenerate' : 'Generate'
      }),
      !editing && brief && jsx('button', {
        type: 'button',
        className: 'text-xs text-(--ui-accent)',
        onClick: startEdit,
        children: 'Edit'
      }),
      speakingNow && jsx('button', {
        type: 'button',
        className: 'text-xs text-[#f85149]',
        onClick: stopSpeech,
        children: 'Stop'
      })
    ] }),
    children: jsxs(Fragment, {
      children: [
        briefQ.isLoading && jsxs('div', { className: 'space-y-2', children: [
          jsx(Skel, { h: '.9rem', w: '92%' }),
          jsx(Skel, { h: '.9rem', w: '78%', delay: 120 }),
          jsx(Skel, { h: '.9rem', w: '85%', delay: 240 })
        ] }),
        genState === 'running' && jsxs('div', { className: 'mt-2 flex items-center gap-2 text-sm text-(--ui-text-tertiary)', children: [
          jsx(RingSpin, {}),
          'Running a session turn — usually 30–90s…'
        ] }),
        typeof genState === 'string' && jsxs('div', { className: 'mt-2 text-sm', children: ['Generate failed: ', genState] }),
        runState === 'preparing' && jsxs('div', { className: 'mt-2 flex items-center gap-2 text-sm text-(--ui-text-tertiary)', children: [
          jsx(RingSpin, {}),
          brief ? 'JARVIS is writing the spoken script…' : 'Generating the brief, then JARVIS reads it aloud…'
        ] }),
        typeof runState === 'string' && jsxs('div', { className: 'mt-2 text-xs text-[#f85149]', children: ['Brief run failed: ', runState] }),
        editing && jsxs('div', { className: 'mt-2', children: [
          jsx('textarea', {
            value: draft,
            onChange: e => setDraft(e.target.value),
            rows: 14,
            spellCheck: false,
            className: 'w-full rounded-lg border border-(--ui-accent)/40 bg-[rgba(6,10,16,.6)] p-3 font-mono text-[0.78rem] leading-relaxed text-(--ui-text-primary) outline-none focus:border-(--ui-accent)',
            placeholder: 'Edit the brief markdown — add, change or delete items, then save'
          }),
          jsxs('div', { className: 'mt-2 flex items-center gap-2', children: [
            jsx('button', { type: 'button', className: 'ao-btn', onClick: saveEdit, disabled: saveState === 'saving' || !draft.trim(), children: saveState === 'saving' ? 'saving…' : 'SAVE' }),
            jsx('button', { type: 'button', className: 'ao-btn', onClick: () => { setEditing(false); setSaveState(null) }, children: 'CANCEL' }),
            typeof saveState === 'string' && jsx('span', { className: 'text-xs text-[#f85149]', children: saveState }),
            saveState === 'saved' && jsx('span', { className: 'text-xs text-[#3fb950]', children: 'saved' })
          ] })
        ] }),
        !editing && brief && jsx(FadeIn, {
          text: brief,
          className: 'mt-2 whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-(--ui-text-secondary)'
        }),
        !brief && !briefQ.isLoading && genState !== 'running' && runState !== 'preparing' && jsx('div', {
          className: 'mt-2 text-sm text-(--ui-text-tertiary)',
          children: 'No brief for today yet. Goals, live metrics, service status and open tasks feed it.'
        }),
        runRes && (runRes.followUps || []).length > 0 && jsxs('div', { className: 'mt-3 flex flex-col gap-1.5', children: [
          jsx('div', { className: 'font-medium text-[0.65rem] uppercase tracking-wider text-(--ui-text-tertiary)', children: 'suggested follow-ups — click to run' }),
          runRes.followUps.map((a, i) => jsx('button', {
            type: 'button',
            className: 'ao-runbtn',
            onClick: () => { Chimes.play('up'); JarvisCtl.send(a) },
            children: [jsx('span', { className: 'text-(--ui-accent)', children: '▸' }), a]
          }, 'fu' + i))
        ] }),
        runRes && jsx('details', { className: 'mt-2 text-xs text-(--ui-text-tertiary)', children: [
          jsx('summary', { className: 'cursor-pointer select-none', children: 'spoken script' }),
          jsx('div', { className: 'mt-1 whitespace-pre-wrap text-[0.7rem] leading-relaxed', children: runRes.speech })
        ] }),
        jsx('div', {
          className: 'mt-3 border-t border-(--ui-stroke-secondary) pt-2 text-right font-mono text-[0.6875rem] text-(--ui-text-quaternary)',
          children: now.toLocaleTimeString('en-US', { hour12: false })
        })
      ]
    })
  })
}

// ------------------------------------------------------------ metrics

function MetricsCard() {
  const q = useQuery({
    queryKey: ['agentos', 'metrics'],
    queryFn: () => REST('/metrics'),
    refetchInterval: 120000
  })
  const d = q.data
  const byStatus = (d && d.jobs_by_status) || []
  const maxCount = Math.max(1, ...byStatus.map(s => s.count))
  const [leadsOpen, setLeadsOpen] = useState(false)
  const leadsQ = useQuery({
    queryKey: ['agentos', 'leads'],
    queryFn: () => REST('/metrics/leads'),
    enabled: false
  })
  const leads = (leadsQ.data && leadsQ.data.leads) || []
  function toggleLeads() {
    Chimes.play('up')
    if (!leadsOpen) leadsQ.refetch()
    setLeadsOpen(!leadsOpen)
  }
  return jsx(AoCard, {
    label: 'business metrics',
    delay: 120,
    right: jsx('button', {
      type: 'button',
      className: 'text-xs text-(--ui-accent)',
      onClick: () => q.refetch(),
      children: 'Refresh'
    }),
    children: jsxs(Fragment, {
      children: [
        q.isLoading && jsxs('div', { className: 'grid grid-cols-2 gap-4', children: [
          jsx(Skel, { h: '2.4rem' }), jsx(Skel, { h: '2.4rem', delay: 100 }),
          jsx(Skel, { h: '2.4rem', delay: 200 }), jsx(Skel, { h: '2.4rem', delay: 300 })
        ] }),
        q.error && jsx('div', { className: 'mt-2 text-sm text-(--ui-text-secondary)', children: q.error.message }),
        d && jsxs(Fragment, {
          children: [
            jsxs('div', { className: 'grid grid-cols-2 gap-x-4 gap-y-4', children: [
              jsxs('div', {
                className: 'cursor-pointer rounded-md -mx-1 px-1 py-0.5 transition-colors hover:bg-[rgba(92,214,255,.06)]',
                onClick: toggleLeads,
                title: 'Show this week\u2019s leads',
                children: [jsx('div', { className: 'ao-label mb-0.5', children: 'leads this week' + (leadsOpen ? ' \u25BE' : ' \u25B8') }),
                jsx('div', { className: 'ao-num', children: jsx(AnimNum, { value: d.leads_week }) })] }),
              jsxs('div', { children: [jsx('div', { className: 'ao-label mb-0.5', children: 'jobs this week' }),
                jsx('div', { className: 'ao-num', children: jsx(AnimNum, { value: d.jobs_week }) })] }),
              jsxs('div', { children: [jsx('div', { className: 'ao-label mb-0.5', children: 'revenue mtd' }),
                jsx('div', { className: 'ao-num', children: jsx(AnimNum, { value: d.revenue_mtd, prefix: '$' }) })] }),
              jsxs('div', { children: [jsx('div', { className: 'ao-label mb-0.5', children: 'jobs today' }),
                jsx('div', { className: 'ao-num', children: jsx(AnimNum, { value: d.jobs_today }) })] })
            ] }),
            jsx('div', { className: 'mt-4 space-y-2', children: byStatus.map((s, i) =>
              jsxs('div', {
                className: 'ao-in cursor-pointer', style: { animationDelay: 200 + i * 90 + 'ms' },
                onClick: () => { Chimes.play('up'); ConsoleStore.send('show me the "' + s.status + '" jobs from the hub with their prices and details') },
                title: 'Ask JARVIS for the ' + s.status + ' jobs',
                children: [
                jsxs('div', { className: 'mb-1 flex items-baseline justify-between text-xs', children: [
                  jsx('span', { className: 'text-(--ui-text-tertiary)', children: s.status }),
                  jsxs('span', { className: 'font-mono text-(--ui-text-secondary)', children: [
                    s.count,
                    s.total_price ? ' · ' + fmtMoney(s.total_price) : ''
                  ] })
                ] }),
                jsx('div', { className: 'ao-bar', children: jsx('i', { style: { width: (s.count / maxCount * 100).toFixed(1) + '%' } }) })
              ] }, s.status)
            ) }),
            leadsOpen && jsxs('div', { className: 'mt-4 rounded-lg border border-(--ui-stroke-secondary) bg-[rgba(6,10,16,.45)] p-2.5', children: [
              jsxs('div', { className: 'mb-2 flex items-center justify-between', children: [
                jsx('div', { className: 'ao-label', children: 'this week\u2019s leads' }),
                jsx('button', {
                  type: 'button', className: 'ao-btn text-[10px]',
                  onClick: () => { Chimes.play('up'); ConsoleStore.send('summarize this week\u2019s leads from the hub: who they are, where they came from, and which are worth calling first') },
                  children: '\uD83E\uDD16 ASK JARVIS'
                })
              ] }),
              leadsQ.isFetching && jsx(Skel, { h: '4rem', w: '100%' }),
              leadsQ.error && jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: 'couldn\u2019t load lead details' }),
              !leadsQ.isFetching && !leadsQ.error && leads.length === 0 && jsx('div', { className: 'text-xs text-(--ui-text-quaternary)', children: 'no leads logged this week' }),
              !leadsQ.isFetching && leads.map((L, i) => jsxs('div', { className: 'ao-in mb-1.5 rounded-md border border-(--ui-stroke-secondary) px-2.5 py-1.5', style: { animationDelay: i * 40 + 'ms' }, children: [
                jsxs('div', { className: 'flex items-baseline gap-2 text-xs', children: [
                  jsx('span', { className: 'font-semibold truncate text-(--ui-text-primary)', children: L.name }),
                  jsx('span', { className: 'shrink-0 rounded px-1 py-px font-mono text-[9px] uppercase tracking-wide', style: { background: 'rgba(211,153,34,.12)', color: '#d29922' }, children: L.status || 'new' }),
                  jsx('span', { className: 'ml-auto shrink-0 font-mono text-[10px] text-(--ui-text-quaternary)', children: L.created })
                ] }),
                jsxs('div', { className: 'mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-(--ui-text-tertiary)', children: [
                  L.phone && jsx('span', { children: L.phone }),
                  L.email && jsx('span', { children: L.email }),
                  L.source && jsx('span', { children: 'via ' + L.source }),
                  L.value > 0 && jsx('span', { className: 'text-(--ui-accent)', children: fmtMoney(L.value) + ' est.' })
                ] })
              ] }, L.id))
            ] })
          ]
        })
      ]
    })
  })
}

// ------------------------------------------------------------ calendar & mail (gws)

const GWS_TAG_STYLE = {
  'personal': { background: 'rgba(92,214,255,.10)', color: '#5cd6ff' },
  'arctic az': { background: 'rgba(211,153,34,.12)', color: '#d29922' }
}

function gwsTag(acct) {
  const st = GWS_TAG_STYLE[String(acct).toLowerCase()] || { background: 'rgba(148,163,184,.12)', color: '#94a3b8' }
  return jsx('span', {
    className: 'shrink-0 rounded px-1 py-px font-mono text-[9px] uppercase tracking-wide',
    style: st,
    children: acct
  })
}

// Gmail deep link — the email in the /u/ slot selects the right signed-in
// account regardless of tab order. #inbox opens the unread message, #all
// opens any archived thread (Google Voice notifications).
function gmailUrl(email, id, all) {
  const u = encodeURIComponent(email || '0')
  return 'https://mail.google.com/mail/u/' + u + '/#' + (all ? 'all' : 'inbox') + '/' + id
}

// Per-account email addresses (fetched once, cached backend-side for a week)
function useGwsEmails() {
  const emailQ = useQuery({ queryKey: ['agentos', 'gws-emails'], queryFn: () => REST('/gws/emails') })
  return name => {
    const a = ((emailQ.data && emailQ.data.accounts) || []).find(x => x.name === name)
    return (a && a.email) || ''
  }
}

// ↗ open-in-Gmail affordance for mail/voice rows (stops row click propagation)
function GmailOpenBtn({ email, id, all, title }) {
  return jsx('button', {
    type: 'button',
    className: 'ao-collapse shrink-0',
    title: title || 'Open this message in Gmail',
    onClick: e => {
      e.stopPropagation()
      haptic('tap')
      openExternal(gmailUrl(email, id, all))
    },
    children: '\u2197'
  })
}

// Card-header 'continue into the app' button — opens the source web app itself
// (calendar/gmail/telegram/voice) so an inline action can flow into the real tool.
function AppOpenBtn({ url, label, title }) {
  return jsx('button', {
    type: 'button',
    className: 'ao-btn ml-2 text-[10px]',
    title: title || ('Open ' + label + ' in the browser'),
    onClick: e => {
      e.stopPropagation()
      haptic('tap')
      openExternal(url)
    },
    children: label
  })
}

function fmtWhen(when, allDay) {
  if (!when) return ''
  if (allDay) return 'all-day'
  const d = new Date(when)
  if (isNaN(d)) return when
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function CalendarCard() {
  const q = useQuery({
    queryKey: ['agentos', 'calendar-agenda'],
    queryFn: () => REST('/calendar/agenda'),
    refetchInterval: 300000
  })
  const d = q.data
  const accounts = (d && d.accounts) || []
  const rows = accounts.flatMap(a => (a.items || []).map(e => ({ ...e, acct: a.name })))
    .sort((x, y) => String(x.when).localeCompare(String(y.when)))
  // group by local calendar date — all-day dates are plain YYYY-MM-DD (no TZ
  // shifting through new Date), timed events convert to local date strings
  const localDay = w => {
    if (!w) return ''
    if (!w.includes('T')) return w.slice(0, 10)
    const dt = new Date(w)
    return isNaN(dt) ? '' : dt.toLocaleDateString('sv')
  }
  const todayStr = new Date().toLocaleDateString('sv')
  const tomorrowStr = new Date(Date.now() + 864e5).toLocaleDateString('sv')
  const groupOf = w => { const k = localDay(w); return k === todayStr ? 'today' : k === tomorrowStr ? 'tomorrow' : 'later' }
  const buckets = { today: [], tomorrow: [], later: [] }
  for (const r of rows) buckets[groupOf(r.when)].push(r)
  const failing = accounts.filter(a => !a.ok)
  const emailOf = useGwsEmails()
  // write path — add an event to either account's primary calendar
  const [addOpen, setAddOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [acct, setAcct] = useState('')
  const [day, setDay] = useState('today')
  const [time, setTime] = useState('')
  const [dur, setDur] = useState('45')
  const [adding, setAdding] = useState(false)
  const [addMsg, setAddMsg] = useState(null)
  const acctNames = accounts.map(a => a.name)
  const acctSel = acct || acctNames[0] || 'personal'
  const fld = 'rounded-md border border-(--ui-accent)/40 bg-[rgba(6,10,16,.6)] px-2 py-1 font-mono text-xs text-(--ui-text-primary) outline-none focus:border-(--ui-accent)'
  async function submitAdd() {
    if (!title.trim() || adding) return
    setAdding(true)
    setAddMsg(null)
    try {
      const r = await REST('/calendar/add', {
        method: 'POST',
        body: { account: acctSel, title: title.trim(), day, start: time, duration_min: parseInt(dur, 10) || 45 }
      })
      setAddMsg(r.ok ? 'added' + (r.verified ? ' + verified' : '') + ' — ' + r.summary + ' @ ' + fmtWhen(r.start) + ' (' + r.account + ')' : null)
      if (r.ok) { setTitle(''); q.refetch(); Chimes.play('up') } else Chimes.play('down')
    } catch (e) {
      setAddMsg('failed: ' + (e && e.message ? e.message : 'unknown error'))
      Chimes.play('down')
    } finally {
      setAdding(false)
    }
  }
  return jsx(AoCard, {
    label: 'calendar \u00b7 both accounts',
    delay: 200,
    right: jsxs(Fragment, {
      children: [
        jsx('button', {
          type: 'button',
          className: 'text-xs text-(--ui-accent)',
          onClick: () => setAddOpen(!addOpen),
          children: addOpen ? '\u00d7' : '+ add'
        }),
        jsx('button', {
          type: 'button',
          className: 'text-xs text-(--ui-accent) ml-2',
          onClick: () => q.refetch(),
          children: 'Refresh'
        }),
        jsx(AppOpenBtn, {
          label: '\u2197 calendar',
          url: 'https://calendar.google.com/calendar/u/0/r?authuser=' + encodeURIComponent(emailOf(acctNames[0] || 'personal')),
          title: 'Open Google Calendar in the browser'
        }),
        jsx('button', {
          type: 'button',
          className: 'ao-btn ml-2 text-[10px]',
          onClick: () => { Chimes.play('up'); ConsoleStore.send('read my calendar (both accounts) and plan my day: time blocks, conflicts, and what to push') },
          children: '\uD83E\uDD16 ASK JARVIS'
        })
      ]
    }),
    children: jsxs(Fragment, {
      children: [
        q.isLoading && jsxs('div', { className: 'space-y-3', children: [
          jsx(Skel, { h: '.9rem' }), jsx(Skel, { h: '.9rem', delay: 120 }), jsx(Skel, { h: '.9rem', delay: 240 })
        ] }),
        q.error && jsx('div', { className: 'mt-2 text-sm text-(--ui-text-secondary)', children: q.error.message }),
        d && jsxs(Fragment, {
          children: [
            addOpen && jsxs('div', { className: 'mb-3 rounded-lg border border-(--ui-stroke-secondary) bg-[rgba(6,10,16,.45)] p-2.5', children: [
              jsx('input', {
                className: fld + ' w-full',
                placeholder: 'event title \u2014 e.g. focus block, estimate call',
                value: title,
                onChange: e => setTitle(e.target.value),
                onKeyDown: e => { if (e.key === 'Enter') submitAdd() }
              }),
              jsxs('div', { className: 'mt-2 flex flex-wrap items-center gap-2 text-xs', children: [
                jsx('select', { className: fld, value: acctSel, onChange: e => setAcct(e.target.value),
                  children: (acctNames.length ? acctNames : ['personal', 'arctic az']).map(n => jsx('option', { value: n, children: n }, n)) }),
                jsx('select', { className: fld, value: day, onChange: e => setDay(e.target.value),
                  children: ['today', 'tomorrow'].map(n => jsx('option', { value: n, children: n }, n)) }),
                jsx('input', { className: fld + ' w-20', placeholder: '14:00', value: time, onChange: e => setTime(e.target.value) }),
                jsx('select', { className: fld, value: dur, onChange: e => setDur(e.target.value),
                  children: ['30', '45', '60', '90', '120'].map(n => jsx('option', { value: n, children: n + ' min' }, n)) }),
                jsx('button', { type: 'button', className: 'ao-btn text-[10px]', onClick: submitAdd, disabled: adding,
                  children: adding ? 'adding\u2026' : 'ADD TO CALENDAR' })
              ] }),
              addMsg && jsx('div', { className: 'mt-2 text-[0.625rem] font-mono text-(--ui-text-tertiary)', children: addMsg })
            ] }),
            rows.length === 0 && !failing.length && jsx('div', { className: 'text-xs text-(--ui-text-quaternary)', children: 'nothing on the calendar in the next 2 days' }),
            ['today', 'tomorrow', 'later'].map(g => {
              const items = buckets[g]
              if (!items.length) return null
              return jsxs('div', { className: 'mt-2 first:mt-0', children: [
                jsx('div', { className: 'ao-label mb-1', children: g }),
                jsx('div', { className: 'space-y-1', children: items.map((e, i) =>
                  jsxs('div', {
                    className: 'ao-in flex items-baseline gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-(--chrome-action-hover)',
                    style: { animationDelay: 150 + i * 70 + 'ms', cursor: 'pointer' },
                    onClick: () => { Chimes.play('up'); ConsoleStore.send('tell me about the "' + e.summary + '" event (' + (e.all_day ? 'all-day' : fmtWhen(e.when)) + ') on my ' + e.acct + ' calendar') },
                    title: 'Ask JARVIS about this event',
                    children: [
                      jsx('span', { className: 'w-16 shrink-0 font-mono text-[0.6875rem] text-(--ui-text-tertiary)', children: fmtWhen(e.when, e.all_day) }),
                      jsxs('span', { className: 'min-w-0 flex-1 truncate text-(--ui-text-secondary)', children: [
                        e.summary,
                        e.calendar && !/primary/i.test(e.calendar) && jsx('span', { className: 'ml-1.5 text-[0.625rem] text-(--ui-text-quaternary)', children: e.calendar })
                      ] }),
                      e.id && jsx('button', {
                        type: 'button',
                        className: 'ao-collapse shrink-0',
                        title: 'Open this event in Google Calendar',
                        onClick: ev => {
                          ev.stopPropagation()
                          haptic('tap')
                          openExternal('https://calendar.google.com/calendar/u/0/r/eventedit/' + e.id +
                            '?authuser=' + encodeURIComponent(emailOf(e.acct)))
                        },
                        children: '\u2197'
                      }),
                      gwsTag(e.acct)
                    ]
                  }, e.acct + e.when + e.summary + i))
                })
              ] }, g)
            }),
            failing.map(a => jsx('div', { className: 'mt-2 truncate text-[0.625rem] text-(--ui-text-quaternary)', title: a.error, children: a.name + ': calendar unavailable' }, 'err-' + a.name))
          ]
        })
      ]
    })
  })
}

function MailCard() {
  const q = useQuery({
    queryKey: ['agentos', 'mail-inbox'],
    queryFn: () => REST('/mail/inbox'),
    refetchInterval: 180000
  })
  const d = q.data
  const accounts = (d && d.accounts) || []
  const rows = accounts.flatMap(a => (a.items || []).map(m => ({ ...m, acct: a.name })))
  const failing = accounts.filter(a => !a.ok)
  const emailOf = useGwsEmails()
  return jsx(AoCard, {
    label: 'inbox \u00b7 unread \u00b7 both accounts',
    delay: 240,
    right: jsxs(Fragment, {
      children: [
        jsx('button', {
          type: 'button',
          className: 'text-xs text-(--ui-accent)',
          onClick: () => q.refetch(),
          children: 'Refresh'
        }),
        jsx(AppOpenBtn, { label: '\u2197 gmail', url: 'https://mail.google.com', title: 'Open Gmail in the browser' }),
        jsx('button', {
          type: 'button',
          className: 'ao-btn ml-2 text-[10px]',
          onClick: () => { Chimes.play('up'); ConsoleStore.send('triage my unread email across both accounts: what needs a reply today, what can wait, what is noise') },
          children: '\uD83E\uDD16 ASK JARVIS'
        })
      ]
    }),
    children: jsxs(Fragment, {
      children: [
        q.isLoading && jsxs('div', { className: 'space-y-3', children: [
          jsx(Skel, { h: '.9rem' }), jsx(Skel, { h: '.9rem', delay: 120 }), jsx(Skel, { h: '.9rem', delay: 240 })
        ] }),
        q.error && jsx('div', { className: 'mt-2 text-sm text-(--ui-text-secondary)', children: q.error.message }),
        d && jsxs(Fragment, {
          children: [
            rows.length === 0 && !failing.length && jsx('div', { className: 'text-xs text-(--ui-text-quaternary)', children: 'inboxes clear \u2014 no unread mail' }),
            jsx('div', { className: 'space-y-1', children: rows.map((m, i) =>
              jsxs('div', {
                className: 'ao-in flex items-baseline gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-(--chrome-action-hover)',
                style: { animationDelay: 150 + i * 70 + 'ms', cursor: 'pointer' },
                onClick: () => { Chimes.play('up'); ConsoleStore.send('summarize the unread email "' + m.subject + '" from ' + m.from + ' in my ' + m.acct + ' inbox and draft a reply if it needs one') },
                title: 'Ask JARVIS to summarize + draft a reply',
                children: [
                  jsx('span', { className: 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', style: { background: 'var(--ui-accent)' } }),
                  jsxs('span', { className: 'min-w-0 flex-1', children: [
                    jsxs('span', { className: 'flex items-baseline gap-2', children: [
                      jsx('span', { className: 'shrink-0 max-w-[9rem] truncate text-xs font-semibold text-(--ui-text-primary)', children: m.from || '(unknown)' }),
                      jsx('span', { className: 'truncate text-xs text-(--ui-text-secondary)', children: m.subject }),
                      m.date && jsx('span', { className: 'ml-auto shrink-0 font-mono text-[0.625rem] text-(--ui-text-quaternary)', children: m.date })
                    ] }),
                    m.snippet && jsx('div', { className: 'mt-0.5 truncate text-[0.625rem] text-(--ui-text-tertiary)', children: m.snippet })
                  ] }),
                  m.id && jsx(GmailOpenBtn, { email: emailOf(m.acct), id: m.id }),
                  gwsTag(m.acct)
                ]
              }, (m.id || i) + '-' + m.acct)
            ) }),
            failing.map(a => jsx('div', { className: 'mt-2 truncate text-[0.625rem] text-(--ui-text-quaternary)', title: a.error, children: a.name + ': inbox unavailable' }, 'err-' + a.name))
          ]
        })
      ]
    })
  })
}

// ------------------------------------------------------------ telegram & google voice

function fmtTgAgo(ts) {
  if (!ts) return ''
  const s = Math.max(0, Date.now() / 1000 - ts)
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago'
  if (s < 86400) return Math.round(s / 3600) + 'h ago'
  return Math.round(s / 86400) + 'd ago'
}

const VOICE_KIND_STYLE = {
  'text': { background: 'rgba(92,214,255,.10)', color: '#5cd6ff' },
  'missed call': { background: 'rgba(248,81,73,.12)', color: '#f85149' },
  'voicemail': { background: 'rgba(211,153,34,.12)', color: '#d29922' }
}

// Inline reply composer shared by the telegram + voice cards: type, hit Enter
// or SEND, the message actually goes out. stopPropagation so the row's
// 'ask jarvis' click doesn't fire while typing. Enter sends, Escape closes.
function ReplyComposer({ placeholder, busy, err, onSend, onCancel }) {
  const [txt, setTxt] = useState('')
  return jsxs('div', { className: 'mt-1.5 flex flex-wrap items-center gap-2', onClick: e => e.stopPropagation(), children: [
    jsx('input', {
      value: txt,
      onChange: e => setTxt(e.target.value),
      onKeyDown: e => {
        if (e.key === 'Enter' && txt.trim() && !busy) onSend(txt.trim())
        if (e.key === 'Escape') onCancel()
      },
      placeholder,
      autoFocus: true,
      className: 'min-w-0 flex-1 rounded-md border border-(--ui-accent)/40 bg-[rgba(6,10,16,.6)] px-2 py-1 font-mono text-xs text-(--ui-text-primary) outline-none focus:border-(--ui-accent)'
    }),
    jsx('button', {
      type: 'button', className: 'ao-btn', disabled: busy || !txt.trim(),
      onClick: () => onSend(txt.trim()),
      children: busy ? 'sending\u2026' : 'SEND'
    }),
    jsx('button', { type: 'button', className: 'ao-btn', onClick: onCancel, children: '\u2715' }),
    err && jsx('span', { className: 'w-full text-[0.625rem] text-[#f85149]', children: err })
  ] })
}

// telegram & google voice cards follow

function TelegramCard() {
  const q = useQuery({
    queryKey: ['agentos', 'telegram-chats'],
    queryFn: () => REST('/telegram/chats'),
    refetchInterval: 120000
  })
  const d = q.data
  const chats = (d && d.chats) || []
  // chat identity: every session is a DM with the gateway bot — label rows with
  // WHICH conversation (session) each is: DM badge + started date, so the title
  // (which reads like a task name) can't be mistaken for a contact name.
  const tgMeta = c => {
    const started = c.first_ts
      ? new Date(c.first_ts * (String(Math.round(c.first_ts)).length > 10 ? 1 : 1000)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : ''
    const kind = c.chat_type === 'group' ? 'group' : c.chat_type === 'bot' ? 'bot' : 'dm'
    return { started, kind }
  }
  // inline reply: the gateway bot sends as itself into D's DM — message_id
  // returned by the API is the read-back verification
  const [tgReply, setTgReply] = useState(null)
  const [tgBusy, setTgBusy] = useState(false)
  const [tgErr, setTgErr] = useState('')
  async function sendTgReply(chatId, text, key) {
    setTgBusy(true)
    setTgErr('')
    try {
      await REST('/telegram/reply', { method: 'POST', body: { chat_id: chatId, text } })
      setTgReply(null)
      Chimes.play('up')
      q.refetch()
    } catch (e) {
      setTgErr(String((e && e.message) || e).slice(0, 200))
    }
    setTgBusy(false)
  }
  return jsx(AoCard, {
    label: 'telegram \u00b7 recent chats',
    delay: 260,
    right: jsxs(Fragment, {
      children: [
        jsx(AppOpenBtn, { label: '\u2197 telegram', url: 'https://web.telegram.org/k/#@Darins_Hermes_bot',
          title: 'Open Telegram Web at the bot chat' }),
        jsx('button', {
          type: 'button',
          className: 'text-xs text-(--ui-accent)',
          onClick: () => q.refetch(),
          children: 'Refresh'
        })
      ]
    }),
    children: jsxs(Fragment, {
      children: [
        jsx('div', { className: 'mb-1 text-[0.625rem] text-(--ui-text-quaternary)', children: 'each row = a separate conversation thread with your bot \u00b7 click for JARVIS to read the full thread' }),
        q.isLoading && jsxs('div', { className: 'space-y-3', children: [
          jsx(Skel, { h: '.9rem' }), jsx(Skel, { h: '.9rem', delay: 120 }), jsx(Skel, { h: '.9rem', delay: 240 })
        ] }),
        q.error && jsx('div', { className: 'mt-2 text-sm text-(--ui-text-secondary)', children: q.error.message }),
        d && jsx('div', { className: 'space-y-1', children: chats.length === 0
          ? jsx('div', { className: 'text-xs text-(--ui-text-quaternary)', children: 'no telegram history on the gateway yet' })
          : chats.map((c, i) => {
            const meta = tgMeta(c)
            return jsxs('div', {
              className: 'ao-in flex items-baseline gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-(--chrome-action-hover)',
              style: { animationDelay: 150 + i * 70 + 'ms', cursor: 'pointer' },
              onClick: () => { Chimes.play('up'); ConsoleStore.send('open my telegram conversation "' + c.title + '" \u2014 read the thread and give me a quick summary of what was decided and what is still open') },
              title: 'Telegram ' + meta.kind + ' with @Darins_Hermes_bot \u00b7 started ' + meta.started + ' \u00b7 ' + c.n + ' messages \u2014 ask JARVIS to summarize',
              children: [
                jsx('span', { className: 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', style: { background: '#2AABEE' } }),
                jsxs('span', { className: 'min-w-0 flex-1', children: [
                  jsxs('span', { className: 'flex items-baseline gap-2', children: [
                    jsx('span', {
                      className: 'shrink-0 rounded px-1 font-mono text-[0.5625rem] uppercase',
                      style: { background: meta.kind === 'group' ? 'rgba(211,153,34,.14)' : 'rgba(42,171,238,.12)', color: meta.kind === 'group' ? '#d29922' : '#2AABEE' },
                      children: meta.kind
                    }),
                    jsx('span', { className: 'truncate text-xs font-semibold text-(--ui-text-primary)', children: c.title }),
                    jsx('span', { className: 'ml-auto shrink-0 font-mono text-[0.625rem] text-(--ui-text-quaternary)', children: fmtTgAgo(c.ts) })
                  ] }),
                  c.preview && jsx('div', { className: 'mt-0.5 truncate text-[0.625rem] text-(--ui-text-tertiary)', children: c.preview }),
                  jsx('div', { className: 'mt-0.5 text-[0.5625rem] text-(--ui-text-quaternary)', children: 'dm \u00b7 you \u2194 @Darins_Hermes_bot \u00b7 since ' + meta.started }),
                  tgReply === (c.id || i) && jsx(ReplyComposer, {
                    placeholder: 'reply as @Darins_Hermes_bot \u2014 Enter sends',
                    busy: tgBusy,
                    err: tgErr,
                    onSend: t => sendTgReply(c.chat_id || '6936161944', t, c.id || i),
                    onCancel: () => { setTgReply(null); setTgErr('') }
                  })
                ] }),
                jsx('button', {
                  type: 'button',
                  className: 'ao-collapse shrink-0',
                  title: 'Reply inline — sends as the bot into this chat',
                  onClick: e => { e.stopPropagation(); haptic('tap'); setTgReply(tgReply === (c.id || i) ? null : (c.id || i)); setTgErr('') },
                  children: '\u21a9'
                }),
                jsx('span', { className: 'shrink-0 font-mono text-[0.625rem] text-(--ui-text-quaternary)', children: c.n })
              ]
            }, c.id || i)
          })
        })
      ]
    })
  })
}

function VoiceCard() {
  const q = useQuery({
    queryKey: ['agentos', 'voice-activity'],
    queryFn: () => REST('/voice/activity'),
    refetchInterval: 180000
  })
  const d = q.data
  const accounts = (d && d.accounts) || []
  const rows = accounts.flatMap(a => (a.items || []).map(v => ({ ...v, acct: a.name })))
  const failing = accounts.filter(a => !a.ok)
  // inline reply: GV texts arrive as Gmail from voice.google.com whose footer
  // says 'to respond to this text message, reply to this email' — sending the
  // Gmail thread reply IS the SMS reply. The gmail message id is the handle.
  const [vReply, setVReply] = useState(null) // gmail message id
  const [vBusy, setVBusy] = useState(false)
  const [vErr, setVErr] = useState('')
  const voiceEmailOf = useGwsEmails()
  async function sendVoiceReply(account, mid, text) {
    setVBusy(true)
    setVErr('')
    try {
      await REST('/voice/reply', { method: 'POST', body: { account, message_id: mid, text } })
      setVReply(null)
      Chimes.play('up')
      q.refetch()
    } catch (e) {
      setVErr(String((e && e.message) || e).slice(0, 200))
    }
    setVBusy(false)
  }
  return jsx(AoCard, {
    label: 'google voice \u00b7 texts \u00b7 calls \u00b7 voicemail',
    delay: 300,
    right: jsxs(Fragment, {
      children: [
        jsx(AppOpenBtn, {
          label: '\u2197 voice',
          // open Google Voice under the BUSINESS account (Arctic AZ HVAC gmail)
          // so the displayed GV number is the company line, not the personal one
          url: 'https://voice.google.com?authuser=' + encodeURIComponent(voiceEmailOf('arctic az') || 'arcticazhvac@gmail.com'),
          title: 'Open Google Voice (Arctic AZ business line) in the browser'
        }),
        jsx('button', {
          type: 'button',
          className: 'text-xs text-(--ui-accent)',
          onClick: () => q.refetch(),
          children: 'Refresh'
        })
      ]
    }),
    children: jsxs(Fragment, {
      children: [
        jsx('div', { className: 'mb-1 text-[0.625rem] text-(--ui-text-quaternary)',
          children: 'business line \u00b7 (602) 640-0051 \u00b7 arcticazhvac@gmail.com \u2014 rows from both numbers are tagged by account' }),
        q.isLoading && jsxs('div', { className: 'space-y-3', children: [
          jsx(Skel, { h: '.9rem' }), jsx(Skel, { h: '.9rem', delay: 120 }), jsx(Skel, { h: '.9rem', delay: 240 })
        ] }),
        q.error && jsx('div', { className: 'mt-2 text-sm text-(--ui-text-secondary)', children: q.error.message }),
        d && jsxs(Fragment, {
          children: [
            rows.length === 0 && !failing.length && jsx('div', { className: 'text-xs text-(--ui-text-quaternary)', children: 'no google voice activity in the last 30 days' }),
            jsx('div', { className: 'space-y-1', children: rows.map((v, i) => {
              const vkey = v.id || ((v.contact || i) + '-' + v.date + '-' + i)
              return jsxs('div', {
                className: 'ao-in flex items-baseline gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-(--chrome-action-hover)',
                style: { animationDelay: 150 + i * 70 + 'ms', cursor: 'pointer' },
                onClick: () => { Chimes.play('up'); ConsoleStore.send('my google voice had a ' + v.kind + ' with ' + v.contact + ' \u2014 find that message in my gmail, read the full conversation, and tell me what they need') },
                title: 'Ask JARVIS to pull the full conversation',
                children: [
                  jsx('span', {
                    className: 'shrink-0 rounded px-1 py-px font-mono text-[9px] uppercase tracking-wide',
                    style: VOICE_KIND_STYLE[v.kind] || { background: 'rgba(148,163,184,.12)', color: '#94a3b8' },
                    children: v.kind
                  }),
                  jsxs('span', { className: 'min-w-0 flex-1', children: [
                    jsxs('span', { className: 'flex items-baseline gap-2', children: [
                      jsx('span', { className: 'shrink-0 text-xs font-semibold text-(--ui-text-primary)', children: v.contact }),
                      jsx('span', { className: 'truncate text-xs text-(--ui-text-secondary)', children: v.snippet }),
                      v.date && jsx('span', { className: 'ml-auto shrink-0 font-mono text-[0.625rem] text-(--ui-text-quaternary)', children: v.date.slice(5, 16) })
                    ] }),
                    vReply === vkey && jsx(ReplyComposer, {
                      placeholder: 'reply to ' + v.contact + ' via ' + v.acct + ' \u2014 Enter sends the text',
                      busy: vBusy,
                      err: vErr,
                      onSend: t => sendVoiceReply(v.acct, v.id, t),
                      onCancel: () => { setVReply(null); setVErr('') }
                    })
                  ] }),
                  v.id && jsx(GmailOpenBtn, { email: voiceEmailOf(v.acct), id: v.id, all: true,
                    title: 'Open this thread in Gmail' }),
                  v.id && jsx('button', {
                    type: 'button',
                    className: 'ao-collapse shrink-0',
                    title: 'Reply inline — sends a text from your Google Voice number',
                    onClick: e => { e.stopPropagation(); haptic('tap'); setVReply(vReply === vkey ? null : vkey); setVErr('') },
                    children: '\u21a9'
                  }),
                  gwsTag(v.acct)
                ]
              }, vkey)
            }) }),
            failing.map(a => jsx('div', { className: 'mt-2 truncate text-[0.625rem] text-(--ui-text-quaternary)', title: a.error, children: a.name + ': voice unavailable' }, 'verr-' + a.name))
          ]
        })
      ]
    })
  })
}

// ------------------------------------------------------------ status

function StatusCard() {
  const q = useQuery({
    queryKey: ['agentos', 'status'],
    queryFn: () => REST('/status'),
    refetchInterval: 120000
  })
  const d = q.data
  return jsx(AoCard, {
    label: 'projects & apps',
    delay: 180,
    children: jsxs(Fragment, {
      children: [
        q.isLoading && jsxs('div', { className: 'space-y-3', children: [
          jsx(Skel, { h: '.9rem' }), jsx(Skel, { h: '.9rem', delay: 120 }), jsx(Skel, { h: '.9rem', delay: 240 })
        ] }),
        q.error && jsx('div', { className: 'mt-2 text-sm text-(--ui-text-secondary)', children: q.error.message }),
        d && jsx('div', { className: 'space-y-1', children: (d.services || []).map((s, i) =>
          jsxs('div', {
            className: 'ao-in flex items-start gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-(--chrome-action-hover)',
            style: { animationDelay: 150 + i * 80 + 'ms', cursor: 'pointer' },
            onClick: () => { haptic('tap'); DrawerBus.open(s.name) },
            title: 'Open ' + s.name + ' in the services drawer',
            children: [
              jsx('span', { className: 'mt-1.5 w-4', children: jsx(Led, { up: s.up }) }),
              jsxs('div', { className: 'min-w-0 flex-1', children: [
                jsxs('div', { className: 'flex items-baseline gap-2', children: [
                  jsx('span', { className: 'text-(--ui-text-secondary)', children: s.name }),
                  s.up === false && jsx('span', { className: 'truncate text-xs text-(--ui-text-tertiary)', children: s.detail }),
                  s.ms != null && jsx('span', { className: 'font-mono text-[0.6875rem] text-(--ui-text-quaternary)', children: s.ms + 'ms' }),
                  (s.history || []).filter(h => h && h.ok && h.ms != null).length > 1 &&
                    jsx(Spark, { data: s.history.filter(h => h && h.ok && h.ms != null).map(h => h.ms), up: true, w: 64, h: 16 }),
                  s.updated && jsx('span', { className: 'ml-auto shrink-0 font-mono text-[0.6875rem] text-(--ui-text-quaternary)', children: s.updated })
                ] }),
                s.note && jsx('div', { className: 'truncate text-xs text-(--ui-text-tertiary)', title: s.note, children: s.note })
              ] })
            ]
          }, s.name)
        ) })
      ]
    })
  })
}

// ------------------------------------------------------------ todos

function TodosCard() {
  const qc = useQueryClient()
  const [txt, setTxt] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const add = async () => {
    const title = txt.trim()
    if (!title || busy) return
    setBusy(true)
    setErr('')
    try {
      await REST('/todos/create', { method: 'POST', body: { title } })
      setTxt('')
      await qc.invalidateQueries({ queryKey: ['agentos', 'todos'] })
    } catch (e) {
      setErr(e && e.message ? String(e.message).slice(0, 160) : 'create failed')
    } finally {
      setBusy(false)
    }
  }
  const [doneId, setDoneId] = useState(null)
  const [menuFor, setMenuFor] = useState(null)
  useEffect(() => {
    if (!menuFor) return undefined
    const onKey = e => { if (e.key === 'Escape') setMenuFor(null) }
    // Close on any press outside the menu + its trigger. A fixed backdrop div
    // is NOT reliable here: ancestors with blur/transform re-scope `fixed` to
    // the card, so clicks outside the card never hit it and the menu sticks.
    const onDown = e => {
      if (e.target && e.target.closest && e.target.closest('[data-task-menu]')) return
      setMenuFor(null)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [menuFor])
  const complete = async t => {
    if (doneId) return
    setDoneId(t.id)
    setErr('')
    haptic('tap')
    try {
      await REST('/todos/complete', { method: 'POST', body: { id: t.id, title: t.title } })
      await qc.invalidateQueries({ queryKey: ['agentos', 'todos'] })
    } catch (e) {
      setErr(e && e.message ? String(e.message).slice(0, 160) : 'complete failed')
    } finally {
      setDoneId(null)
    }
  }
  const q = useQuery({
    queryKey: ['agentos', 'todos'],
    queryFn: () => REST('/todos'),
    refetchInterval: 120000
  })
  const p = useQuery({
    queryKey: ['agentos', 'planner'],
    queryFn: () => REST('/planner/today'),
    refetchInterval: 180000
  })
  const d = q.data
  const pl = p.data
  const plannerOk = pl && pl.state === 'ok'
  const plannerRows = plannerOk ? [
    ...(pl.inbox_overdue || []).map(r => ({ ...r, tag: 'overdue', danger: true })),
    ...(pl.repeating_today || []).map(r => ({ ...r, tag: 'daily', done: r.checked_today })),
    ...(pl.inbox_today || []).map(r => ({ ...r, tag: 'inbox' })),
    ...(pl.planner_tasks || []).map(r => ({ ...r, tag: 'planner' }))
  ] : []
  const habitKeys = plannerOk ? Object.keys(pl.habits || {}) : []
  const totalOpen = (d ? d.total_open : 0) + plannerRows.filter(r => !r.done).length
  return jsx(AoCard, {
    label: 'today',
    delay: 240,
    right: d && jsx('span', { className: 'font-mono text-xs text-(--ui-text-quaternary)', children: totalOpen + ' open' }),
    children: jsxs(Fragment, {
      children: [
        jsx('div', {
          className: 'mb-2 flex items-center gap-1.5',
          children: [
            jsx('input', {
              value: txt,
              onChange: e => setTxt(e.target.value),
              onKeyDown: e => { if (e.key === 'Enter') add() },
              placeholder: 'add task to board…',
              disabled: busy,
              className: 'min-w-0 flex-1 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-tertiary-background) px-2.5 py-1.5 text-sm text-(--ui-text-primary) outline-none transition-colors placeholder:text-(--ui-text-quaternary) focus:border-(--ui-accent) disabled:opacity-50'
            }),
            jsx('button', {
              onClick: () => { add() },
              disabled: busy || !txt.trim(),
              className: 'shrink-0 rounded-md border border-(--ui-stroke-secondary) px-2.5 py-1.5 font-mono text-[0.65rem] uppercase text-(--ui-text-secondary) transition-colors hover:border-(--ui-accent) hover:text-(--ui-accent) disabled:opacity-40',
              children: busy ? '…' : 'add'
            })
          ]
        }),
        err && jsx('div', { className: 'mb-2 text-xs text-[#f85149]', children: err }),
        plannerOk && pl.focus && jsx('div', {
          className: 'mb-2 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-tertiary-background) px-2.5 py-2 text-sm text-(--ui-text-primary)',
          children: jsxs('span', { className: 'flex items-baseline gap-2', children: [
            jsx('span', { className: 'shrink-0 text-[0.65rem] uppercase tracking-wider text-(--ui-accent)', children: 'focus' }),
            jsx('span', { children: pl.focus })
          ] })
        }),
        plannerOk && habitKeys.length > 0 && jsx('div', {
          className: 'mb-2 flex flex-wrap items-center gap-2',
          children: habitKeys.map((h, i) => jsx('span', {
            className: 'ao-in flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ' +
              (pl.habits[h] ? 'border-(--ui-stroke-primary) text-(--ui-text-primary)' : 'border-(--ui-stroke-secondary) text-(--ui-text-tertiary)'),
            style: { animationDelay: 120 + i * 60 + 'ms' },
            children: jsxs('span', { className: 'flex items-center gap-1.5', children: [
              jsx(Led, { up: pl.habits[h] ? true : null }),
              jsx('span', { children: h })
            ] })
          }, h))
        }),
        plannerOk && jsx('div', { className: 'space-y-1', children: plannerRows.map((t, i) =>
          jsxs('div', {
            className: 'ao-in flex items-baseline gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-(--chrome-action-hover)',
            style: { animationDelay: 120 + i * 70 + 'ms' },
            onMouseEnter: () => HoverBus.set((t.text || '').toLowerCase()),
            onMouseLeave: () => HoverBus.clear(),
            children: [
              jsx('span', {
                className: cn('shrink-0 rounded border px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wider',
                  t.danger ? 'border-[#f8514966] text-[#f85149]' : 'border-(--ui-stroke-secondary) text-(--ui-text-tertiary)',
                  t.done && 'opacity-50'),
                children: t.tag
              }),
              jsx('span', {
                className: cn(t.done ? 'text-(--ui-text-tertiary) line-through' : 'text-(--ui-text-secondary)'),
                children: t.text
              })
            ]
          }, t.id || (t.tag + i))
        ) }),
        q.isLoading && jsx(Skel, { h: '.9rem' }),
        q.error && jsx('div', { className: 'mt-2 text-sm text-(--ui-text-secondary)', children: q.error.message }),
        d && d.tasks.length === 0 && plannerRows.length === 0 && jsx('div', { className: 'py-2 text-sm text-(--ui-text-tertiary)', children: 'No open tasks.' }),
        d && jsx('div', { className: 'space-y-1', children: d.tasks.map((t, i) => {
    const txt2 = (t.title || '').toLowerCase()
    // overflow menu actions (hover-revealed — keeps the resting row at 2 buttons)
    const extraActions = [
      { icon: '\uD83E\uDDE9', label: 'break it down', title: 'Ask JARVIS to break this into steps', cmd: 'break this task into concrete ordered steps and add them to my list: ' + (t.title || '') },
      { icon: '\u23F0', label: 'remind me tonight', title: 'Evening reminder via Telegram', cmd: 'remind me tonight about: ' + (t.title || '') },
      { icon: '\uD83D\uDCE8', label: 'push to telegram', title: 'Send this task to your Telegram as a note', cmd: 'send this to my telegram as a task note: ' + (t.title || '') },
    ]
    const hasScript2 = /\.py\b|run\s|script/.test(txt2)
    const hasDown2 = /down|port|refused|502|winerror/.test(txt2)
    const kind2 = hasScript2 ? 'run' : hasDown2 ? 'restart' : 'delegate'
    const label2 = kind2 === 'run' ? '\u26A1' : kind2 === 'restart' ? '\uD83D\uDD04' : '\uD83E\uDD16'
    const cmd2 = kind2 === 'run' ? 'run python ' + (t.title.match(/([\w_.-]+\.py)/)?.[1] || 'script')
      : kind2 === 'restart' ? 'restart service ' + (t.title.match(/['\u2018\u2019]([^'\u2018\u2019]+)['\u2018\u2019]/)?.[1] || 'unknown')
      : t.title
    return jsxs('div', {
            className: 'group ao-in relative flex items-baseline gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-(--chrome-action-hover) ' +
              // the ao-in fill-mode animation puts EVERY row in its own stacking
              // context, so the menu's z-index can't escape its row — raise the
              // open row above its siblings or later rows paint over the menu
              (menuFor === t.id ? 'z-40' : ''),
            style: { animationDelay: 240 + i * 70 + 'ms' },
            onMouseEnter: () => HoverBus.set((t.title || '').toLowerCase()),
            onMouseLeave: () => HoverBus.clear(),
            children: [
              jsx('span', {
                className: 'shrink-0 rounded border border-(--ui-stroke-secondary) px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wider text-(--ui-text-tertiary)',
                children: t.status
              }),
              jsx('span', { className: 'min-w-0 flex-1 text-(--ui-text-secondary)', children: t.title }),
              jsx('button', {
                type: 'button',
                className: 'ao-btn',
                'data-kind': kind2,
                onClick: () => { ConsoleStore.send(cmd2) },
                title: (kind2 === 'run' ? 'Run script with JARVIS: ' : kind2 === 'restart' ? 'Restart service with JARVIS: ' : 'Delegate to JARVIS: ') + (cmd2 || ''),
                'aria-label': (kind2 === 'run' ? 'Run script: ' : kind2 === 'restart' ? 'Restart service: ' : 'Delegate to JARVIS: ') + (t.title || ''),
                children: label2
              }),
              jsxs('span', { 'data-task-menu': true, className: 'relative ml-auto flex shrink-0 items-center gap-1', children: [
                jsx('button', {
                  type: 'button',
                  disabled: doneId === t.id,
                  onClick: () => complete(t),
                  title: 'Mark done (syncs to Telegram)',
                  'aria-label': 'Complete: ' + t.title,
                  className: 'rounded border border-(--ui-stroke-secondary) px-1.5 py-0.5 font-mono text-[0.6rem] uppercase text-(--ui-text-tertiary) transition-colors hover:border-[#3fb950] hover:text-[#3fb950] disabled:opacity-40',
                  children: doneId === t.id ? '\u2026' : '\u2713'
                }),
                jsx('button', {
                  type: 'button',
                  onClick: () => setMenuFor(menuFor === t.id ? null : t.id),
                  'aria-label': 'More actions: ' + t.title,
                  'aria-expanded': menuFor === t.id,
                  title: 'More actions',
                  className: 'rounded border border-transparent px-1.5 py-0.5 font-mono text-[0.6rem] text-(--ui-text-quaternary) opacity-0 transition-opacity duration-150 hover:border-(--ui-stroke-secondary) hover:text-(--ui-accent) focus:opacity-100 group-hover:opacity-100 ' + (menuFor === t.id ? 'opacity-100 text-(--ui-accent)' : ''),
                  children: '\u22EF'
                }),
                menuFor === t.id && jsx('div', { role: 'menu', className: 'ao-in absolute right-0 z-30 w-48 overflow-hidden rounded-lg border border-(--ui-stroke-secondary) bg-[rgba(10,14,20,0.96)] shadow-xl backdrop-blur-md ' + (i >= d.tasks.length - 2 ? 'bottom-full mb-1' : 'top-full mt-1'), style: { animationDuration: '180ms' },
                    children: extraActions.map(x => jsxs('button', {
                      type: 'button', role: 'menuitem',
                      title: x.title,
                      onClick: () => { setMenuFor(null); ConsoleStore.send(x.cmd) },
                      className: 'flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-(--ui-text-secondary) transition-colors duration-150 hover:bg-(--ui-tertiary-background) hover:text-(--ui-text-primary)',
                      children: [
                        jsx('span', { className: 'w-4 shrink-0 text-center', children: x.icon }),
                        jsx('span', { children: x.label })
                      ]
                    }, x.label))
                  })
              ] })
            ]
          }, t.id)
          })}),
        p.data && pl.state !== 'ok' && pl.state !== 'no_key' && jsx('div', {
          className: 'mt-2 text-xs text-(--ui-text-tertiary)',
          children: 'Planner: ' + pl.state + ' — ' + (pl.detail || '')
        })
      ]
    })
  })
}

// ------------------------------------------------------------ advisor

const TIER_STYLE = {
  1: { label: 'P1', cls: 'border-[#f85149]/40 bg-[#f8514911] text-[#f85149]' },
  2: { label: 'P2', cls: 'border-[#3fb950]/40 bg-[#3fb95011] text-[#3fb950]' },
  3: { label: 'P3', cls: 'border-[#d29922]/40 bg-[#d2992211] text-[#d29922]' }
}

function ActionRow({ a, busy, onDone, onKill }) {
  const tier = TIER_STYLE[a.tier] || TIER_STYLE[3]
  const [cmdBusy, setCmdBusy] = useState(false)
  const [, force] = useState(0)
  useEffect(() => {
    if (!cmdBusy) return undefined
    return ConsoleStore.subscribe(() => force(v => v + 1))
  }, [cmdBusy])
  const txt = (a.text || '').toLowerCase()
  const hasScript = /\.py\b|run\s|script/.test(txt)
  const hasDown = /down|port|refused|502|winerror/.test(txt)
  const kind = hasScript ? 'run' : hasDown ? 'restart' : 'delegate'
  const label = kind === 'run' ? '\u26A1 RUN SCRIPT' : kind === 'restart' ? '\uD83D\uDD04 RESTART' : '\uD83E\uDD16 DELEGATE'
  const cmd = kind === 'run' ? 'run python ' + (a.text.match(/([\w_.-]+\.py)/)?.[1] || 'script')
    : kind === 'restart' ? 'restart service ' + (a.text.match(/['\u2018\u2019]([^'\u2018\u2019]+)['\u2018\u2019]/)?.[1] || 'unknown')
    : a.text
  const recentMsgs = ConsoleStore.msgs.filter(m => m.role === 'jarvis').slice(-3)
  const lastReply = recentMsgs.length > 0 ? recentMsgs[recentMsgs.length - 1].text : ''
  async function doAction() {
    setCmdBusy(true)
    await ConsoleStore.send(cmd)
    setCmdBusy(false)
  }
  return jsxs('div', {
    className: 'flex flex-wrap items-start gap-2 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-tertiary-background) p-2',
    onMouseEnter: () => HoverBus.set((a.text || '').toLowerCase()),
    onMouseLeave: () => HoverBus.clear(),
    children: [
      jsx('span', { className: 'mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[0.65rem] font-bold ' + tier.cls, children: tier.label }),
      jsx('div', { className: 'ao-row-text', children: [
        jsx('span', { className: 'block text-sm leading-snug text-(--ui-text-primary) ' + (a.status && a.status !== 'open' ? 'line-through opacity-50' : ''), children: a.text }),
        cmdBusy && jsx('div', { className: 'ao-mini-term', children: lastReply || 'Running\u2026' })
      ] }),
      a.status === 'open' || !a.status ? jsxs('div', { className: 'ao-row-actions flex shrink-0 gap-1', children: [
        jsx('button', {
          type: 'button',
          className: 'ao-btn',
          'data-kind': kind,
          disabled: busy || cmdBusy,
          onClick: doAction,
          title: cmd,
          children: cmdBusy ? '\u2026' : label
        }),
        jsx('button', {
          disabled: busy || cmdBusy,
          onClick: () => onDone(a.id),
          className: 'rounded border border-(--ui-stroke-secondary) px-2 py-1 font-mono text-[0.65rem] uppercase text-(--ui-text-secondary) transition-colors hover:border-[#3fb950] hover:text-[#3fb950] disabled:opacity-40',
          children: busy ? '\u2026' : 'done'
        }),
        jsx('button', {
          disabled: busy || cmdBusy,
          onClick: () => onKill(a.id),
          className: 'rounded border border-(--ui-stroke-secondary) px-2 py-1 font-mono text-[0.65rem] uppercase text-(--ui-text-tertiary) transition-colors hover:border-[#f85149] hover:text-[#f85149] disabled:opacity-40',
          children: busy ? '\u2026' : 'kill'
        })
      ] }) : jsx('span', { className: 'shrink-0 font-mono text-[0.65rem] uppercase text-(--ui-text-tertiary)', children: a.status })
    ]
  }, a.id)
}

function AdvisorCard() {
  const qc = useQueryClient()
  const advQ = useQuery({
    queryKey: ['agentos', 'advisor'],
    queryFn: () => REST('/advisor'),
    refetchInterval: 180000
  })
  const [genState, setGenState] = useState(null)
  const [busyId, setBusyId] = useState(null)

  async function generate() {
    setGenState('running')
    haptic('tap')
    try {
      await REST('/advisor/generate', { method: 'POST', body: {}, timeoutMs: 480000 })
      setGenState(null)
      qc.invalidateQueries({ queryKey: ['agentos', 'advisor'] })
    } catch (e) {
      setGenState(String((e && e.message) || e).slice(0, 200))
    }
  }

  async function act(id, action) {
    setBusyId(id)
    haptic('tap')
    OrbBus.set('working')
    try {
      await REST('/advisor/action', { method: 'POST', body: { id, action } })
      qc.invalidateQueries({ queryKey: ['agentos', 'advisor'] })
    } catch (e) { /* row stays open; error visible on next refetch */ }
    setBusyId(null)
    OrbBus.set('idle')
  }

  const d = advQ.data
  const actions = (d && d.actions) || []
  const accountability = (d && d.accountability) || []
  const shownIds = new Set(actions.map(a => a.id))
  const loopRows = accountability.filter(r => !shownIds.has(r.id))

  // Mood: P1 item → alert (overrides degraded from services)
  useEffect(() => {
    const hasP1 = actions.some(a => a.tier === 1 && (!a.status || a.status === 'open'))
    if (hasP1) OrbBus.setMood('alert')
  }, [actions])

  return jsx(AoCard, {
    label: 'advisor — top 3 today',
    delay: 30,
    right: jsx('button', {
      type: 'button',
      className: 'text-xs text-(--ui-accent)',
      onClick: generate,
      children: genState === 'running' ? 'Thinking…' : actions.length ? 'Rerank' : 'Generate'
    }),
    children: jsxs('div', { className: 'flex flex-col gap-2', children: [
      genState === 'running' && jsxs('div', { className: 'flex items-center gap-2 text-sm text-(--ui-text-tertiary)', children: [
        jsx(RingSpin, {}),
        'Chief-of-staff pass — reading scout data + ledger…'
      ] }),
      genState && genState !== 'running' && jsx('div', { className: 'text-xs text-[#f85149]', children: 'Advisor error: ' + genState }),
      advQ.isLoading && jsxs('div', { className: 'space-y-2', children: [
        jsx(Skel, { h: '2.2rem', w: '100%' }),
        jsx(Skel, { h: '2.2rem', w: '94%', delay: 120 })
      ] }),
      !advQ.isLoading && !genState && actions.length === 0 && jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: 'No advisor run yet today. Generate to get your top three.' }),
      actions.map(a => jsx(ActionRow, { a, busy: busyId === a.id, onDone: id => act(id, 'done'), onKill: id => act(id, 'kill') })),
      loopRows.length > 0 && jsxs('div', { className: 'mt-1 border-t border-(--ui-stroke-secondary) pt-2', children: [
        jsxs('div', { className: 'mb-1.5 font-mono text-[0.65rem] uppercase tracking-wider text-(--ui-text-tertiary)', children: [
          'accountability loop — ', loopRows.length, ' open'
        ] }),
        jsx('div', { className: 'flex flex-col gap-1.5', children: loopRows.map(r => jsxs('div', {
          className: 'flex flex-wrap items-start gap-2 rounded-md border px-2 py-1.5 ' +
            (r.escalated ? 'border-[#d29922]/50 bg-[#d2992211]' : 'border-(--ui-stroke-secondary)'),
          onMouseEnter: () => HoverBus.set((r.text || '').toLowerCase()),
          onMouseLeave: () => HoverBus.clear(),
          children: [
            jsx('span', {
              className: 'shrink-0 font-mono text-[0.65rem] ' + (r.escalated ? 'text-[#d29922]' : 'text-(--ui-text-tertiary)'),
              children: r.escalated ? '⚠ ' + r.age_days + 'd ignored' : r.age_days + 'd'
            }),
            jsx('span', { className: 'min-w-0 flex-1 text-xs leading-snug text-(--ui-text-secondary)', children: r.text }),
            jsxs('div', { className: 'ao-row-actions flex shrink-0 gap-1', children: [
              jsx('button', {
                disabled: busyId === r.id,
                onClick: () => act(r.id, 'done'),
                className: 'rounded border border-(--ui-stroke-secondary) px-1.5 py-0.5 font-mono text-[0.6rem] uppercase text-(--ui-text-secondary) transition-colors hover:border-[#3fb950] hover:text-[#3fb950] disabled:opacity-40',
                children: 'done'
              }),
              jsx('button', {
                disabled: busyId === r.id,
                onClick: () => act(r.id, 'kill'),
                className: 'rounded border border-(--ui-stroke-secondary) px-1.5 py-0.5 font-mono text-[0.6rem] uppercase text-(--ui-text-tertiary) transition-colors hover:border-[#f85149] hover:text-[#f85149] disabled:opacity-40',
                children: 'kill'
              })
            ] })
          ]
        }, r.id)) })
      ] })
    ] })
  })
}

// ------------------------------------------------------------ console widget

function ConsoleCard({ compact = false }) {
  const [, force] = useState(0)
  useEffect(() => ConsoleStore.subscribe(() => force(v => v + 1)), [])
  const msgs = ConsoleStore.msgs
  const busy = ConsoleStore.busy
  const [input, setInput] = useState('')
  const [listening, setListening] = useState(false)
  const [micOk] = useState(() => typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition))
  const recRef = useRef(null)
  const scrollRef = useRef(null)

  const ttsOn = Tts.on()
  const ttsRate = Tts.rate()
  const [volOpen, setVolOpen] = useState(false)
  const ttsVol = Tts.vol()
  const TTS_RATES = [0.9, 1.05, 1.25, 1.5]
  function cycleRate() {
    const i = TTS_RATES.indexOf(ttsRate)
    try { localStorage.setItem('agentos-tts-rate', JSON.stringify(TTS_RATES[(i + 1) % TTS_RATES.length])) } catch { /* ignore */ }
    force(v => v + 1)
  }
  function toggleTts() {
    const next = !ttsOn
    try { localStorage.setItem('agentos-tts', next ? 'on' : 'off') } catch { /* ignore */ }
    if (!next && typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
    force(v => v + 1)
  }

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [msgs.length, busy])

  // Expose send/voice to the spotlight + hero (closures refreshed every render).
  useEffect(() => {
    JarvisCtl.toggleVoice = () => { if (micOk && !listening) startVoice() }
    JarvisCtl.canVoice = micOk
  })

  async function send(text) {
    const query = (text != null ? text : input).trim()
    if (!query) return
    setInput('')
    await ConsoleStore.send(query)
  }

  function startVoice() {
    if (!micOk || listening) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const rec = new SR()
    recRef.current = rec
    rec.interimResults = true
    rec.continuous = false
    rec.lang = 'en-US'
    let finalText = ''
    rec.onresult = ev => {
      let interim = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript
        if (ev.results[i].isFinal) finalText += t + ' '
        else interim += t
      }
      setInput((finalText + interim).trim())
    }
    rec.onend = () => {
      setListening(false)
      OrbBus.set(ConsoleStore.busy ? 'thinking' : 'idle')
      if (finalText.trim()) send(finalText.trim())
    }
    rec.onerror = () => {
      setListening(false)
      OrbBus.set(ConsoleStore.busy ? 'thinking' : 'idle')
    }
    setListening(true)
    OrbBus.set('listening')
    Chimes.play('up')
    OrbBus.startMic()
    rec.start()
  }

  // Hold-spacebar push-to-talk: press Space anywhere (outside a text field)
  // to start listening, release to stop + send. Reuses startVoice's flow —
  // rec.onend sends the final transcript.
  const listeningRef = useRef(false)
  listeningRef.current = listening
  const startVoiceRef = useRef(null)
  startVoiceRef.current = startVoice
  useEffect(() => {
    if (!micOk) return
    const isTyping = t => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    const onKey = e => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (isTyping(e.target)) return
      e.preventDefault()
      if (!listeningRef.current) startVoiceRef.current()
    }
    const onKeyUp = e => {
      if (e.code !== 'Space' || isTyping(e.target)) return
      if (listeningRef.current && recRef.current) { try { recRef.current.stop() } catch { /* ignore */ } }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp) }
  }, [micOk])

  return jsxs('div', { className: 'flex flex-col gap-2', children: [
    msgs.length > 0 && jsx('div', {
      ref: scrollRef,
      className: 'space-y-2 overflow-y-auto pr-1 ' + (compact ? 'max-h-56' : 'max-h-72'),
      children: msgs.map((m, i) => jsx('div', {
        className: 'text-sm leading-relaxed',
        children: jsxs('span', { className: 'flex flex-col gap-0.5', children: [
          jsx('span', {
            className: 'font-medium text-[0.65rem] uppercase tracking-wider ' +
              (m.role === 'you' ? 'text-(--ui-text-tertiary)' : 'text-(--ui-accent)'),
            children: m.role === 'you' ? 'You' : 'JARVIS'
          }),
          m.role === 'jarvis' && i === msgs.length - 1 && !busy
            ? jsx('span', { className: 'whitespace-pre-wrap text-(--ui-text-secondary)', children: m.text })
            : jsx('span', { className: 'whitespace-pre-wrap ' + (m.role === 'you' ? 'text-(--ui-text-primary)' : 'text-(--ui-text-secondary)'), children: m.text })
        ] })
      }, i))
    }),
    busy && jsxs('div', { className: 'flex items-center gap-2 text-xs text-(--ui-text-tertiary)', children: [
      jsx('span', { className: 'ao-ring' }),
      'working…'
    ] }),
    jsxs('div', { className: 'flex items-center gap-2', children: [
      jsx('span', { className: 'ao-mini-orb', 'data-busy': busy || listening ? '1' : '0', 'aria-hidden': 'true' }),
      Tts.supported && jsxs('div', { className: 'relative shrink-0', children: [
        jsx('button', {
          onClick: () => setVolOpen(o => !o),
          className: 'flex h-9 w-9 items-center justify-center rounded-full border transition-colors ' +
            (ttsOn
              ? 'border-(--ui-accent) text-(--ui-accent)'
              : 'border-(--ui-stroke-secondary) text-(--ui-text-tertiary) hover:border-(--ui-accent) hover:text-(--ui-accent)'),
          title: 'Voice volume — click to open',
          children: jsx('span', { className: 'text-sm', children: ttsOn ? '🔊' : '🔇' })
        }),
        volOpen && jsxs('div', {
          className: 'absolute bottom-11 left-0 z-50 w-60 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-card) p-3 shadow-2xl',
          children: [
            jsx('div', { className: 'mb-2 text-[0.65rem] uppercase tracking-wider text-(--ui-text-tertiary)', children: 'voice volume' }),
            jsxs('div', { className: 'flex items-center gap-2', children: [
              jsx('button', {
                onClick: toggleTts,
                className: 'ao-kbd shrink-0 ' + (ttsOn ? 'text-(--ui-accent)' : 'text-[#f85149]'),
                title: ttsOn ? 'Mute voice replies' : 'Unmute voice replies',
                children: ttsOn ? 'mute' : 'muted'
              }),
              jsx('input', {
                type: 'range', min: 0, max: 100, value: Math.round(ttsVol * 100),
                onChange: e => { Tts.setVolume(e.target.value / 100); force(v => v + 1) },
                className: 'min-w-0 flex-1 accent-[#a855f7]',
                'aria-label': 'Voice volume'
              }),
              jsx('span', { className: 'w-8 shrink-0 text-right text-xs text-(--ui-text-secondary)', children: Math.round(ttsVol * 100) + '%' })
            ] })
          ]
        })
      ] }),
      micOk && jsx('button', {
        onClick: startVoice,
        className: 'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ' +
          (listening
            ? 'border-[#f85149] text-[#f85149] hover:bg-[#f8514911]'
            : 'border-(--ui-stroke-secondary) text-(--ui-text-secondary) hover:border-(--ui-accent) hover:text-(--ui-accent)'),
        title: listening ? 'Listening…' : 'Voice command (or hold SPACE — push to talk)',
        children: jsx('span', { className: 'text-sm', children: listening ? '■' : '●' })
      }),
      jsx('input', {
        value: input,
        onChange: e => setInput(e.target.value),
        onKeyDown: e => { if (e.key === 'Enter') send() },
        placeholder: micOk ? 'Ask JARVIS — type, click ●, or hold SPACE…' : 'Ask JARVIS — type, or dictate with Typeless…',
        className: 'min-w-0 flex-1 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-tertiary-background) px-3 py-2 text-sm text-(--ui-text-primary) outline-none transition-colors placeholder:text-(--ui-text-tertiary) focus:border-(--ui-accent)'
      }),
      jsx('button', {
        onClick: () => send(),
        disabled: busy || !input.trim(),
        className: 'shrink-0 rounded-md border border-(--ui-stroke-secondary) px-3 py-2 text-xs uppercase tracking-wider text-(--ui-text-secondary) transition-colors enabled:hover:border-(--ui-accent) enabled:hover:text-(--ui-accent) disabled:opacity-40',
        children: busy ? '…' : 'Run'
      })
    ] }),
    !compact && jsx('div', { className: 'flex items-center gap-2 text-xs', children:
      jsx('button', {
        type: 'button',
        onClick: cycleRate,
        title: 'Voice reply speed — click to cycle',
        className: 'ao-kbd',
        children: 'speed ' + ttsRate + '×'
      })
    })
  ] })
}

// ------------------------------------------------------------ goals

function GoalsCard() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['agentos', 'goals'],
    queryFn: () => REST('/goals')
  })
  const [text, setText] = useState(null)
  const [saveState, setSaveState] = useState(null)

  useEffect(() => {
    if (q.data && text === null) setText(q.data.text || '')
  }, [q.data]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaveState('saving')
    try {
      await REST('/goals', { method: 'POST', body: { text } })
      setSaveState('saved ' + new Date().toLocaleTimeString())
      qc.invalidateQueries({ queryKey: ['agentos', 'goals'] })
    } catch (e) {
      setSaveState('save failed: ' + String((e && e.message) || e))
    }
  }

  return jsx(AoCard, {
    label: 'goals (quarterly / monthly / weekly)',
    right: jsxs('div', { className: 'flex items-center gap-2', children: [
      saveState && jsx('span', { className: 'font-mono text-xs text-(--ui-text-tertiary)', children: saveState }),
      jsx('button', { type: 'button', className: 'text-xs text-(--ui-accent)', onClick: save, children: 'Save' })
    ] }),
    children: jsxs(Fragment, {
      children: [
        q.isLoading && jsx(Skel, { h: '16rem', w: '100%' }),
        text !== null && jsx('textarea', {
          value: text,
          onChange: e => { setText(e.target.value); setSaveState(null) },
          spellCheck: false,
          className: cn('mt-1 h-72 w-full resize-y rounded-md border border-(--ui-stroke-secondary)',
            'bg-transparent p-3 text-sm leading-relaxed text-(--ui-text-secondary) outline-none',
            'transition-shadow focus:border-(--ui-accent)')
        })
      ]
    })
  })
}

// ------------------------------------------------------------ money

function MoneyConnector({ name, data, onRefresh, refreshing, delay = 0 }) {
  const configured = data && data.configured
  const state = data && data.state
  const stateColor = !configured ? 'var(--ui-text-quaternary)' : state === 'ok' ? '#3fb950' : '#d29922'
  const [fixBusy, setFixBusy] = useState(false)
  const [fixMsg, setFixMsg] = useState(null)
  async function reconnectWebull() {
    setFixBusy(true)
    setFixMsg(null)
    try {
      const r = await REST('/money/webull/login', { method: 'POST', body: {} })
      setFixMsg(r && r.launched ? 'Login window opened — type the MFA code there.' : 'Could not open login: ' + ((r && r.detail) || 'unknown'))
      onRefresh()
    } catch (e) {
      setFixMsg('Reconnect failed: ' + ((e && e.message) || e))
    } finally {
      setFixBusy(false)
    }
  }
  return jsx(AoCard, {
    label: name,
    delay,
    right: jsxs('div', { className: 'flex items-center gap-3', children: [
      jsx(Led, { up: configured ? (state === 'ok' ? true : null) : null }),
      jsx('button', {
        type: 'button',
        className: 'ao-btn text-xs text-(--ui-accent)',
        onClick: onRefresh,
        disabled: refreshing,
        title: 'Refetch now',
        className: 'ao-btn text-xs text-(--ui-accent) ' + (refreshing ? 'opacity-70' : ''),
        children: refreshing ? jsxs(Fragment, { children: [
          jsx(RingSpin, { size: 12 }),
          jsx('span', { children: 'refreshing…' })
        ] }) : 'Refresh'
      })
    ] }),
    children: jsxs(Fragment, {
      children: [
        refreshing && jsx('div', { className: 'text-xs text-(--ui-text-tertiary)',
          style: { animation: 'aoGlowLine 1.6s ease-in-out infinite' },
          children: 'live refetch — each source can take up to 90s; this card updates the moment it lands' }),
        !data && jsx(Skel, { h: '3rem', w: '100%' }),
        data && !configured && jsxs(Fragment, { children: [
          jsx('div', { className: 'text-sm text-(--ui-text-secondary)', children: 'Not connected.' }),
          jsx('div', { className: 'mt-1 text-xs text-(--ui-text-tertiary)', children: data.detail })
        ] }),
        data && configured && state !== 'ok' && jsxs(Fragment, { children: [
          jsxs('div', { className: 'flex items-center gap-2 text-sm', style: { color: stateColor }, children: [
            'State: ',
            state
          ] }),
          data.detail && jsx('div', { className: 'mt-1 text-xs text-(--ui-text-tertiary)', children: data.detail }),
          state === 'reauth_needed' && jsxs(Fragment, { children: [
            jsx('button', {
              type: 'button',
              className: 'ao-btn mt-2',
              'data-kind': 'run',
              onClick: reconnectWebull,
              disabled: fixBusy,
              children: fixBusy ? 'opening login…' : '⚙ reconnect webull'
            }),
            fixMsg && jsx('div', { className: 'mt-1 text-xs text-(--ui-text-secondary)', children: fixMsg })
          ] })
        ] }),
        data && configured && state === 'ok' && jsx('div', { className: 'mt-1 space-y-0.5', children:
          String(data.render || '').split('\n').map((line, i) =>
            jsx('div', {
              className: 'ao-in text-[0.8125rem] text-(--ui-text-secondary)',
              style: { animationDelay: i * 60 + 'ms' },
              children: line || '\u00A0'
            }, i)
          )
        })
      ]
    })
  })
}


function MoneySection() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['agentos', 'money'],
    queryFn: () => REST('/money/summary')
  })
  const d = q.data
  const positions = (d && d.stocks && d.stocks.state === 'ok' && Array.isArray(d.stocks.positions))
    ? d.stocks.positions : []
  const refresh = () => { qc.invalidateQueries({ queryKey: ['agentos', 'money'] }); q.refetch() }
  return jsxs('div', { className: 'flex flex-col gap-3', children: [
    q.error && jsx('div', { className: 'text-sm text-(--ui-text-secondary)', children: q.error.message }),
    jsx('div', { className: 'grid grid-cols-1 gap-3', children: [
      jsx(QuotesCard, {}),
      jsx(MoneyConnector, { name: 'stripe — balance & payouts', data: d && d.stripe, onRefresh: refresh, refreshing: q.isFetching, delay: 40 }),
      jsx(MoneyConnector, { name: 'webull — positions', data: d && d.stocks, onRefresh: refresh, refreshing: q.isFetching, delay: 120 }),
      jsx(MoneyConnector, { name: 'banks (plaid) — balances & transactions', data: d && d.banks, onRefresh: refresh, refreshing: q.isFetching, delay: 200 })
    ] }),
    jsx('div', {
      className: 'ao-in text-xs text-(--ui-text-quaternary)',
      style: { animationDelay: '280ms' },
      children: 'Credentials live in ~/.hermes/agentos/.env — fill it in yourself, never through chat.'
    })
  ] })
}

// ------------------------------------------------------------ vision (JARVIS eyes)

function VisionCard() {
  const qc = useQueryClient()
  const [img, setImg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const lastQ = useQuery({
    queryKey: ['agentos', 'vision-last'],
    queryFn: () => REST('/vision/last'),
    refetchInterval: 600000
  })
  const res = lastQ.data && lastQ.data.ok ? lastQ.data : null

  async function analyze(dataUrl) {
    setImg(dataUrl); setErr(null); setBusy(true)
    OrbBus.set('thinking'); Chimes.play('up')
    try {
      await REST('/vision/analyze', { method: 'POST', body: { image: dataUrl }, timeoutMs: 150000 })
      qc.invalidateQueries({ queryKey: ['agentos', 'vision-last'] })
    } catch (e) {
      setErr(String((e && e.message) || e).slice(0, 220))
    }
    setBusy(false); OrbBus.set('idle')
  }

  function grabScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setErr('screen capture not available in this window'); return
    }
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(stream => {
      const v = document.createElement('video')
      v.srcObject = stream
      v.muted = true
      v.onloadedmetadata = () => {
        v.play()
        const c = document.createElement('canvas')
        const scale = Math.min(1, 1600 / (v.videoWidth || 1600))
        c.width = Math.round(v.videoWidth * scale)
        c.height = Math.round(v.videoHeight * scale)
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
        stream.getTracks().forEach(t => t.stop())
        analyze(c.toDataURL('image/jpeg', 0.85))
      }
    }).catch(() => setErr('screen capture cancelled or denied'))
  }

  function grabFile(f) {
    if (!f || !f.type.startsWith('image/')) { setErr('not an image file'); return }
    const r = new FileReader()
    r.onload = () => { if (typeof r.result === 'string') analyze(r.result) }
    r.readAsDataURL(f)
  }

  useEffect(() => {
    const onPaste = e => {
      const items = e.clipboardData && e.clipboardData.items
      if (!items) return
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) {
          const f = it.getAsFile()
          if (f) grabFile(f)
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  function runAction(a) {
    Chimes.play('up')
    OrbBus.set('working')
    JarvisCtl.send(a)
  }

  const fileRef = useRef(null)

  return jsx(AoCard, {
    label: 'vision — screen & image analysis',
    delay: 20,
    right: jsx('button', {
      type: 'button',
      className: 'text-xs text-(--ui-accent)',
      onClick: grabScreen,
      children: 'Capture screen'
    }),
    children: jsxs('div', { className: 'flex flex-col gap-2', children: [
      jsxs('div', { className: 'flex flex-wrap items-center gap-2 text-xs text-(--ui-text-tertiary)', children: [
        jsx('button', {
          type: 'button',
          onClick: () => fileRef.current && fileRef.current.click(),
          className: 'ao-runbtn',
          children: 'Upload image'
        }),
        jsx('input', { ref: fileRef, type: 'file', accept: 'image/*', style: { display: 'none' },
          onChange: e => { grabFile(e.target.files && e.target.files[0]); e.target.value = '' } }),
        jsx('span', { children: '…or paste an image with Ctrl+V' })
      ] }),
      img && jsx('img', { src: img, className: 'ao-vision-img w-full object-cover', alt: 'captured frame' }),
      busy && jsxs('div', { className: 'flex items-center gap-2 text-sm text-(--ui-text-tertiary)', children: [
        jsx(RingSpin, {}),
        'Visual cortex processing…'
      ] }),
      err && jsx('div', { className: 'text-xs text-[#f85149]', children: 'Vision error: ' + err }),
      !busy && res && jsxs(Fragment, { children: [
        jsx('div', {
          className: 'rounded-md border border-(--ui-accent)/30 bg-(--ui-tertiary-background) px-2.5 py-2 text-sm text-(--ui-text-primary)',
          children: res.spokenSummary
        }),
        jsx('div', { className: 'whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-(--ui-text-secondary)', children: res.detailedAnalysis }),
        (res.entities || []).length > 0 && jsxs('div', { className: 'flex flex-wrap gap-1.5', children: [
          res.entities.map((en, i) => jsxs('span', {
            className: 'ao-chip', title: en, children: [jsx('i', {}), jsx('span', { children: en })]
          }, 'en' + i))
        ] }),
        (res.suggestedActions || []).length > 0 && jsxs('div', { className: 'flex flex-col gap-1.5', children: [
          jsx('div', { className: 'font-medium text-[0.65rem] uppercase tracking-wider text-(--ui-text-tertiary)', children: 'suggested commands' }),
          res.suggestedActions.map((a, i) => jsx('button', {
            type: 'button', className: 'ao-runbtn', onClick: () => runAction(a),
            children: [jsx('span', { className: 'text-(--ui-accent)', children: '▸' }), a]
          }, 'sa' + i))
        ] }),
        res.extractedText && jsxs('details', { className: 'text-xs text-(--ui-text-tertiary)', children: [
          jsx('summary', { className: 'cursor-pointer select-none', children: 'extracted text' }),
          jsx('pre', { className: 'mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[0.7rem]', children: res.extractedText })
        ] }),
        res.at && jsx('div', { className: 'text-[0.65rem] text-(--ui-text-quaternary)', children: 'analyzed ' + res.at })
      ] }),
      !busy && !res && !err && jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: 'Capture a screen, paste or upload an image — JARVIS reads it and proposes commands.' })
    ] })
  })
}

// ------------------------------------------------------------ quotes (no-auth market tickers)

function QuoteRow({ q, onRemove, delay }) {
  const [open, setOpen] = useState(false)
  const up = (q.change_pct || 0) >= 0
  const price = q.price == null ? '—'
    : q.price >= 1000 ? q.price.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const series = (q.series || []).filter(v => typeof v === 'number')
  return jsxs('div', {
    className: 'ao-in rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-(--chrome-action-hover)',
    style: { animationDelay: delay + 'ms', cursor: 'pointer' },
    onClick: () => setOpen(o => !o),
    title: open ? 'Click to collapse' : 'Click for detail + actions',
    children: [
      jsxs('div', { className: 'flex items-center gap-2', children: [
        jsx('span', { className: 'w-24 shrink-0 truncate text-(--ui-text-secondary)', children: q.symbol }),
        jsx('span', { className: 'ao-num w-24 shrink-0 !text-base', children: price }),
        jsx('span', { className: 'w-16 shrink-0 text-xs', style: { color: up ? '#3fb950' : '#f85149' },
          children: q.change_pct == null ? '—' : (up ? '+' : '') + q.change_pct.toFixed(2) + '%' }),
        jsx('div', { className: 'min-w-0 flex-1 overflow-hidden', children: jsx(Spark, { data: q.series, up, w: open ? 220 : 120, h: open ? 40 : 22 }) }),
        onRemove && jsx('button', {
          type: 'button', onClick: e => { e.stopPropagation(); onRemove(q.symbol) }, title: 'Remove ' + q.symbol,
          className: 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base leading-none text-(--ui-text-quaternary) transition-colors hover:bg-[#f85149]/15 hover:text-[#f85149]',
          children: '\u2715'
        })
      ] }),
      open && jsxs('div', { className: 'mt-1.5 flex flex-wrap items-center gap-2 border-t border-(--ui-stroke-secondary) pt-1.5', children: [
        jsx('span', { className: 'text-[0.65rem] text-(--ui-text-quaternary)', children: series.length + ' intraday points · ' + (series.length ? 'day range ' + Math.min(...series).toFixed(2) + '–' + Math.max(...series).toFixed(2) : '') }),
        jsx('button', {
          type: 'button', className: 'ao-btn',
          onClick: e => { e.stopPropagation(); Chimes.play('up'); ConsoleStore.send('analyze ' + q.symbol + ' — momentum, key levels and a buy/hold/sell read for today') },
          children: 'ask jarvis'
        }),
        jsx('button', {
          type: 'button', className: 'ao-btn',
          onClick: e => { e.stopPropagation(); Chimes.play('up'); ConsoleStore.send('what is the latest news and outlook for ' + q.symbol + '?') },
          children: 'news'
        })
      ] })
    ]
  }, q.symbol)
}

function QuotesCard() {
  const DEFAULT_WATCH = { stocks: ['SPY', 'QQQ', 'NVDA', 'MSFT'], crypto: ['BTC-USD', 'ETH-USD'] }
  const [watchRaw, setWatch] = useLocal('agentos-quotes', DEFAULT_WATCH)
  // heal corrupted storage (older builds could persist a function/null here)
  const watch = useMemo(() => ({
    stocks: (watchRaw && Array.isArray(watchRaw.stocks) && watchRaw.stocks.length ? watchRaw.stocks : DEFAULT_WATCH.stocks),
    crypto: (watchRaw && Array.isArray(watchRaw.crypto)) ? watchRaw.crypto : DEFAULT_WATCH.crypto
  }), [watchRaw])
  useEffect(() => {
    if (!watchRaw || !Array.isArray(watchRaw.stocks) || !Array.isArray(watchRaw.crypto)) setWatch(watch)
  }, [])
  const q = useQuery({
    queryKey: ['agentos', 'quotes', watch],
    queryFn: () => REST('/quotes?symbols=' + encodeURIComponent(watch.stocks.join(',')) + '&crypto=' + encodeURIComponent(watch.crypto.join(','))),
    refetchInterval: 60000
  })
  const [add, setAdd] = useState('')
  function addSym() {
    const s = add.trim().toUpperCase()
    if (!s) return
    setWatch(s.endsWith('-USD')
      ? { ...watch, crypto: Array.from(new Set([...watch.crypto, s])) }
      : { ...watch, stocks: Array.from(new Set([...watch.stocks, s])) })
    setAdd('')
  }
  function remove(sym) {
    setWatch({
      stocks: watch.stocks.filter(x => x !== sym),
      crypto: watch.crypto.filter(x => x !== sym)
    })
  }
  const d = q.data
  // every watched symbol gets a row, even if the quote service has no data for
  // it — an added ticker must never just vanish
  const rows = []
  for (const sym of watch.stocks) rows.push((d && d.stocks || []).find(x => x.symbol === sym) || { symbol: sym, missing: true })
  for (const sym of watch.crypto) rows.push((d && d.crypto || []).find(x => x.symbol === sym) || { symbol: sym, missing: true })
  return jsx(AoCard, {
    label: 'live tickers — yahoo finance, no login',
    delay: 80,
    right: jsx('span', { className: 'text-xs text-(--ui-text-quaternary)', children: 'auto-refresh 60s' }),
    children: jsxs('div', { className: 'flex flex-col gap-2', children: [
      q.isLoading && jsxs('div', { className: 'space-y-2', children: [
        jsx(Skel, { h: '1.4rem', w: '90%' }), jsx(Skel, { h: '1.4rem', w: '84%', delay: 120 })
      ] }),
      q.error && jsx('div', { className: 'text-sm text-(--ui-text-secondary)', children: q.error.message }),
      rows.map((row, i) =>
        jsx(QuoteRow, { q: row, delay: 100 + i * 70, onRemove: sym => remove(sym) })
      ),
      jsxs('div', { className: 'flex items-center gap-2', children: [
        jsx('input', {
          value: add,
          onChange: e => setAdd(e.target.value),
          onKeyDown: e => { if (e.key === 'Enter') addSym() },
          placeholder: 'Add ticker (AAPL or BTC-USD)…',
          className: 'min-w-0 flex-1 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-tertiary-background) px-3 py-1.5 text-sm text-(--ui-text-primary) outline-none transition-colors placeholder:text-(--ui-text-tertiary) focus:border-(--ui-accent)'
        }),
        jsx('button', {
          type: 'button', onClick: addSym, disabled: !add.trim(),
          className: 'shrink-0 rounded-md border border-(--ui-stroke-secondary) px-3 py-1.5 text-xs uppercase tracking-wider text-(--ui-text-secondary) transition-colors enabled:hover:border-(--ui-accent) enabled:hover:text-(--ui-accent) disabled:opacity-40',
          children: 'add'
        })
      ] })
    ] })
  })
}

// ------------------------------------------------------------ encrypted export / import

function ExportCard() {
  const [state, setState] = useState(null)
  const fileRef = useRef(null)

  async function doExport() {
    const pass = window.prompt('Encryption passphrase (AES-256-GCM). Needed again to import this bundle:')
    if (pass === null) return
    if (!pass) { setState('export cancelled — empty passphrase'); return }
    setState('packing…')
    OrbBus.set('working')
    try {
      const d = await REST('/export')
      const plain = new TextEncoder().encode(JSON.stringify({ agentos: 1, date: d.date, goals: d.goals, recs: d.recs, apps: d.apps }))
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
      const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: iv, iterations: 150000, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))
      const magic = new TextEncoder().encode('AGOS1')
      const blob = new Blob([magic, iv, ct], { type: 'application/octet-stream' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'agentos-backup-' + (d.date || 'bundle') + '.agos'
      a.click()
      URL.revokeObjectURL(a.href)
      setState('exported (encrypted with your passphrase)')
      OrbBus.set('idle')
    } catch (e) {
      setState('failed: ' + String((e && e.message) || e).slice(0, 140))
      OrbBus.set('idle')
    }
  }

  async function doImport(f) {
    if (!f) return
    const pass = window.prompt('Passphrase for this bundle:')
    if (pass === null) return
    setState('decoding…')
    OrbBus.set('working')
    try {
      const buf = new Uint8Array(await f.arrayBuffer())
      const magic = new TextDecoder().decode(buf.slice(0, 5))
      if (magic !== 'AGOS1') throw new Error('not an agentos bundle')
      const iv = buf.slice(5, 17), ct = buf.slice(17)
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
      const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: iv, iterations: 150000, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
      const plain = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)))
      const r = await REST('/import', { method: 'POST', body: { goals: plain.goals, recs: plain.recs, apps: plain.apps } })
      setState('imported: ' + ((r.restored || []).join(', ') || 'nothing'))
      OrbBus.set('idle')
    } catch (e) {
      setState('failed: ' + String((e && e.message) || e).slice(0, 140))
      OrbBus.set('idle')
    }
  }

  return jsx(AoCard, {
    label: 'encrypted backup — goals, advisor ledger, app notes',
    delay: 60,
    children: jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
      jsx('button', {
        type: 'button', onClick: doExport,
        className: 'rounded-md border border-(--ui-stroke-secondary) px-3 py-1.5 text-xs uppercase tracking-wider text-(--ui-text-secondary) transition-colors hover:border-(--ui-accent) hover:text-(--ui-accent)',
        children: 'Export bundle'
      }),
      jsx('button', {
        type: 'button', onClick: () => fileRef.current && fileRef.current.click(),
        className: 'rounded-md border border-(--ui-stroke-secondary) px-3 py-1.5 text-xs uppercase tracking-wider text-(--ui-text-secondary) transition-colors hover:border-(--ui-accent) hover:text-(--ui-accent)',
        children: 'Import bundle'
      }),
      jsx('input', { ref: fileRef, type: 'file', accept: '.agos,application/octet-stream', style: { display: 'none' },
        onChange: e => { doImport(e.target.files && e.target.files[0]); e.target.value = '' } }),
      state && jsx('span', { className: 'text-xs text-(--ui-text-tertiary)', children: state })
    ] })
  })
}

// ------------------------------------------------------------ system orbit (3D ring of plugins & tools)

// Popular hosted connectors, in offer-order, for the "connect an app" strip.
const CONNECT_SUGGESTED = ['gmail', 'notion', 'slack', 'linear', 'github_copilot_mcp', 'airtable',
  'jira', 'calendly', 'todoist_mcp', 'shopify', 'sendgrid', 'vercel_mcp', 'supabase', 'plaid_mcp']

function OrbitCard() {
  const q = useQuery({
    queryKey: ['agentos', 'connectors'],
    queryFn: () => REST('/connectors'),
    refetchInterval: 300000,
    retry: 1
  })
  const [connectBusy, setConnectBusy] = useState(null)
  const [connectErr, setConnectErr] = useState(null)
  const d = q.data
  // Outer ring: local MCP tools. Inner ring: hosted connectors (connected first).
  const outerItems = (d && d.mcps) || []
  const hostedAll = (d && d.hosted) || []
  const innerItems = hostedAll.filter(h => h.connected)
  const portalUrl = (d && d.portal_url) || 'https://portal.nousresearch.com/connectors'
  const suggested = CONNECT_SUGGESTED
    .map(n => hostedAll.find(h => h.name === n))
    .filter(h => h && !h.connected)
    .slice(0, 8)
  const dataRef = useRef({ outer: outerItems, inner: innerItems })
  dataRef.current = { outer: outerItems, inner: innerItems }
  const ref = useRef(null)

  function openItem(it, kind) {
    haptic('tap')
    Chimes.play('up')
    if (kind === 'hosted' && it.connected === false) { startConnect(it.name); return }
    if (it.url) openExternal(it.url)
  }

  // Kick off the hosted-connector OAuth flow and open the portal link.
  async function startConnect(name) {
    if (connectBusy) return
    setConnectBusy(name)
    setConnectErr(null)
    try {
      const r = await REST('/connectors/connect', { method: 'POST', body: { name }, timeoutMs: 60000 })
      openExternal(r.url)
    } catch (e) {
      setConnectErr(String((e && e.message) || e).slice(0, 200))
    }
    setConnectBusy(null)
  }

  useEffect(() => {
    const root = ref.current
    if (!root) return undefined
    let raf = 0
    let t0 = performance.now()
    let w = 1, h = 1
    const measure = () => {
      const r = root.getBoundingClientRect()
      w = Math.max(1, r.width)
      h = Math.max(1, r.height)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    measure()
    function frame(now) {
      raf = 0
      const t = (now - t0) / 1000
      const { outer: pl, inner: mc } = dataRef.current
      const cx = w / 2, cy = h / 2
      const outer = { rx: Math.max(90, Math.min(w / 2 - 60, 340)), ry: Math.min(105, h / 2 - 22) }
      const inner = { rx: outer.rx * 0.6, ry: outer.ry * 0.52 }
      const els = root.querySelectorAll('.ao-orbit-item')
      for (const el of els) {
        const isIn = el.dataset.ring === 'in'
        const ring = isIn ? inner : outer
        const n = isIn ? Math.max(1, mc.length) : Math.max(1, pl.length)
        const idx = Number(el.dataset.idx) || 0
        const a = (isIn ? -t * 0.28 : t * 0.2) + idx * (Math.PI * 2 / n)
        const x = cx + Math.sin(a) * ring.rx
        const y = cy + Math.cos(a) * ring.ry
        const depth = (Math.cos(a) + 1) / 2
        el.style.transform = 'translate(-50%,-50%) translate(' + (x - cx).toFixed(1) + 'px,' + (y - cy).toFixed(1) + 'px) scale(' + (0.72 + 0.38 * depth).toFixed(3) + ')'
        el.style.opacity = String(0.3 + 0.7 * depth)
        el.style.zIndex = depth > 0.5 ? '20' : '2'
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  const connectedCount = innerItems.length
  return jsx(AoCard, {
    label: 'system orbit — connectors & tools',
    delay: 360,
    right: jsx('span', {
      className: 'text-xs text-(--ui-text-quaternary)',
      children: q.error ? 'orbit offline' : connectedCount + ' connected · ' + outerItems.length + ' tools'
    }),
    children: jsxs('div', {
      children: [
        jsxs('div', {
          ref,
          className: 'ao-orbit-stage',
          children: [
            jsx('div', { className: 'ao-orbit-center' }),
            q.isLoading && jsx(Skel, { h: '2rem', w: '40%', className: 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2' }),
            outerItems.map(it => jsxs('button', {
              type: 'button',
              className: 'ao-chip ao-orbit-item',
              'data-ring': 'out', 'data-idx': outerItems.indexOf(it),
              title: it.url ? (it.name + ' · local tool — open ' + it.url) : (it.name + ' · local tool (no web app)'),
              style: { cursor: it.url ? 'pointer' : 'default' },
              onClick: () => openItem(it, 'mcp'),
              children: [jsx('i', { style: it.enabled === false ? { background: '#d29922', boxShadow: 'none' } : undefined }), jsx('span', { children: it.name })]
            }, 'p' + it.name)),
            innerItems.map(it => jsxs('button', {
              type: 'button',
              className: 'ao-chip ao-orbit-item',
              'data-ring': 'in', 'data-idx': innerItems.indexOf(it),
              title: it.name + ' · connector — open ' + (it.url || 'app'),
              onClick: () => openItem(it, 'hosted'),
              children: [jsx('i', {}), jsx('span', { children: it.name })]
            }, 'm' + it.name)),
            !q.isLoading && outerItems.length === 0 && innerItems.length === 0 && !q.error && jsx('div', { className: 'absolute inset-0 flex items-center justify-center text-sm text-(--ui-text-tertiary)', children: 'No connectors or tools yet — connect an app below.' })
          ]
        }),
        q.error && jsxs('div', { className: 'mt-2 text-xs text-[#f85149]', children: ['Orbit data failed: ', String((q.error && q.error.message) || q.error).slice(0, 200)] }),
        !q.error && jsx('div', { className: 'mt-2 border-t border-(--ui-stroke-secondary) pt-2', children: jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
          jsx('span', { className: 'font-mono text-[0.65rem] uppercase tracking-wider text-(--ui-text-tertiary)', children: 'connect an app:' }),
          suggested.map(it => jsx('button', {
            type: 'button',
            className: 'ao-runbtn',
            disabled: connectBusy === it.name,
            title: 'Connect ' + it.name + ' — opens the portal sign-in',
            onClick: () => startConnect(it.name),
            children: [jsx('span', { className: 'text-(--ui-accent)', children: '+' }), it.name.replace(/_mcp$/, '')]
          }, 'cs' + it.name)),
          jsx('button', {
            type: 'button',
            className: 'ao-runbtn',
            title: 'Open the full connector catalog',
            onClick: () => { Chimes.play('up'); openExternal(portalUrl) },
            children: [jsx('span', { className: 'text-(--ui-accent)', children: '↗' }), 'all apps']
          }),
          connectErr && jsx('span', { className: 'text-xs text-[#f85149]', children: connectErr })
        ] }) })
      ]
    })
  })
}

// ------------------------------------------------------------ spotlight command runner

const SPOT_QUICK = [
  'Generate my daily brief',
  'What are my top 3 actions today?',
  'Summarize service status',
  'What is on my plate today?'
]

// Slash-command palette for the omni-bar: "/" opens the menu, typing filters.
const SLASH_COMMANDS = [
  { cmd: '/brief', label: 'Run the daily brief', value: () => 'Generate my daily brief' },
  { cmd: '/top3', label: "Today's top 3 actions", value: () => 'What are my top 3 actions today?' },
  { cmd: '/diag', label: 'Summarize service status', value: () => 'Summarize service status' },
  { cmd: '/tasks', label: 'What is on my plate today?', value: () => 'What is on my plate today?' },
  { cmd: '/restart', label: 'Restart a service — /restart <name>', arg: a => "restart service '" + a + "'" },
  { cmd: '/remember', label: 'Store a permanent fact — /remember <text>', arg: a => 'remember that ' + a },
  { cmd: '/forget', label: 'Forget a fact — /forget <text>', arg: a => '/forget ' + a },
  { cmd: '/todo', label: 'Add a task to my list — /todo <text>', arg: a => 'add task to my list: ' + a },
  { cmd: '/mode brief', label: 'View: Briefing (Alt+1)', mode: 'brief' },
  { cmd: '/mode console', label: 'View: Execution console (Alt+2)', mode: 'console' },
  { cmd: '/mode graph', label: 'View: Neural graph (Alt+3)', mode: 'graph' },
  { cmd: '/mode hud', label: 'View: HUD overlay (Alt+4)', mode: 'hud' }
]

function Spotlight({ open, onClose }) {
  const [text, setText] = useState('')
  const [sel, setSel] = useState(0)
  const [listening, setListening] = useState(false)
  const inputRef = useRef(null)
  const [, force] = useState(0)
  useEffect(() => ConsoleStore.subscribe(() => force(v => v + 1)), [])
  useEffect(() => OrbBus.subscribe(st => setListening(st === 'listening')), [])

  const t = text.trim()
  const recent = ConsoleStore.msgs.filter(m => m.role === 'you').slice(-6).reverse()
  let rows
  if (t.startsWith('/')) {
    const head = t.split(/\s+/)[0].toLowerCase()
    rows = SLASH_COMMANDS.filter(c => c.cmd.startsWith(head)).map(c => {
      const arg = t.slice(c.cmd.length).trim()
      return {
        kind: 'slash',
        label: c.label + (c.arg && arg ? '  —  ' + arg : ''),
        value: c.mode ? null : (c.arg ? c.arg(arg) : c.value()),
        mode: c.mode || null
      }
    })
  } else {
    rows = [
      ...(!t ? SPOT_QUICK.map(q => ({ kind: 'quick', label: q, value: q })) : []),
      ...(!t ? recent.map(m => ({ kind: 'recent', label: m.text, value: m.text })) : []),
      ...(t ? [{ kind: 'command', label: 'Ask JARVIS: ' + t, value: t }] : [])
    ]
  }

  useEffect(() => {
    if (open) {
      setText('')
      setSel(0)
      const id = setTimeout(() => inputRef.current && inputRef.current.focus(), 20)
      return () => clearTimeout(id)
    }
    return undefined
  }, [open])

  if (!open) return null

  function run(rowOrValue) {
    // accept either a raw string or a row object (slash commands may switch modes)
    const row = typeof rowOrValue === 'object' ? rowOrValue : null
    const value = row ? row.value : rowOrValue
    if (row && row.mode) { onClose(); haptic('tap'); ModeStore.set(row.mode); return }
    if (!value) return
    onClose()
    Chimes.play('up')
    JarvisCtl.send(value)
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(rows.length - 1, s + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[sel]
      run(row || text.trim())
    }
  }

  return jsx('div', {
    className: 'ao-spot-backdrop',
    onMouseDown: e => { if (e.target === e.currentTarget) onClose() },
    children: jsxs('div', {
      className: 'ao-spot',
      role: 'dialog', 'aria-label': 'Command runner',
      onKeyDown: onKey,
      children: [
        jsxs('div', { className: 'ao-spot-input', children: [
          jsx('span', { className: 'text-(--ui-accent)', 'aria-hidden': 'true', children: '⌘' }),
          jsx('input', {
            ref: inputRef,
            value: text,
            onChange: e => { setText(e.target.value); setSel(0) },
            placeholder: 'Ask JARVIS anything — commands, questions, actions…',
            'aria-label': 'Command input',
            spellCheck: false
          }),
          listening && jsxs('span', { className: 'flex items-center gap-[3px]', 'aria-label': 'listening', children: [
            [0, 1, 2, 3].map(i => jsx('span', {
              className: 'inline-block w-[3px] rounded-full bg-(--ui-accent)',
              style: { height: 10 + (i % 2) * 6, animation: 'aoPulse 1s ease-in-out ' + (i * 120) + 'ms infinite' }
            }, i))
          ] }),
          jsx('span', { className: 'ao-kbd', children: 'esc' })
        ] }),
        jsxs('div', { className: 'ao-spot-list', children: [
          rows.length === 0 && jsx('div', { className: 'px-3 py-6 text-center text-sm text-(--ui-text-tertiary)', children: t.startsWith('/') ? 'No matching command — Enter asks JARVIS.' : 'Type a command and press Enter.' }),
            rows.map((row, i) => jsxs('div', {
              className: 'ao-spot-row',
              'data-sel': i === sel ? '1' : '0',
              onMouseEnter: () => setSel(i),
              onClick: () => run(row),
              children: [
                jsx('span', {
                  className: 'flex-none ' + (row.kind === 'recent' ? 'text-(--ui-text-quaternary)' : 'text-(--ui-accent)'),
                  'aria-hidden': 'true',
                  children: row.kind === 'recent' ? '↺' : row.kind === 'quick' ? '✦' : row.kind === 'slash' ? '/' : '▸'
                }),
                jsx('span', { className: 'min-w-0 flex-1 truncate', children: row.label })
              ]
            }, row.kind + i))
        ] }),
        jsxs('div', { className: 'ao-spot-foot', children: [
          jsxs('span', { children: ['↑↓ navigate · ↵ run'] }),
          jsx('span', { className: 'ml-auto', children: 'replies appear in the command dock / console' })
        ] })
      ]
    })
  })
}

// ------------------------------------------------------------ hero (compact status ribbon)

function stopJarvisSpeech() {
  Tts.stop()
  if (OrbBus.state === 'speaking') OrbBus.set('idle')
}

function HeroWidget({ onOpenSpotlight, onOpenServices }) {
  const [state, setState] = useState(OrbBus.state)
  useEffect(() => OrbBus.subscribe(setState), [])
  const [curCmd, setCurCmd] = useState(null)
  const [doneFlash, setDoneFlash] = useState(null)
  useEffect(() => {
    const sync = () => {
      setCurCmd(ConsoleStore.busy ? ConsoleStore.current : null)
      const d = ConsoleStore.lastDone
      if (d && Date.now() - d.at < 6000) setDoneFlash(d)
    }
    sync()
    return ConsoleStore.subscribe(sync)
  }, [])
  // Esc stops voice playback while JARVIS is speaking
  useEffect(() => {
    if (state !== 'speaking') return
    const onKey = e => { if (e.key === 'Escape') stopJarvisSpeech() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state])
  const now = useNow()
  const statusQ = useQuery({
    queryKey: ['agentos', 'status'],
    queryFn: () => REST('/status'),
    refetchInterval: 120000
  })
  const todosQ = useQuery({
    queryKey: ['agentos', 'todos'],
    queryFn: () => REST('/todos'),
    refetchInterval: 120000
  })
  const metricsQ = useQuery({
    queryKey: ['agentos', 'metrics'],
    queryFn: () => REST('/metrics'),
    refetchInterval: 120000
  })
  const svcs = (statusQ.data && statusQ.data.services) || []
  const up = svcs.filter(s => s.up === true).length
  const down = svcs.filter(s => s.up === false).length
  const open = (todosQ.data && todosQ.data.total_open) || 0
  const word = { idle: 'Standing by', listening: 'Listening…', thinking: 'Processing…', speaking: 'Speaking', working: 'Working…' }[state]
  const busySecs = curCmd ? Math.max(0, Math.round((Date.now() - (ConsoleStore.since || Date.now())) / 1000)) : 0
  const metrics = metricsQ.data
  // Build revenue series for sparkline from metrics data if available
  const revSeries = metrics && metrics.revenue_series ? metrics.revenue_series : null

  // Mood computation for OrbBus (cheap: from already-fetched data)
  useEffect(() => {
    if (!statusQ.data) return
    const mood = down > 0 ? 'degraded' : 'ok'
    OrbBus.setMood(mood)
  }, [down, statusQ.data]) // eslint-disable-line react-hooks/exhaustive-deps

  return jsx('div', {
    className: 'ao-hero ao-in',
    style: { padding: '8px 18px', minHeight: 44 },
    children: [
      // compact state wordmark
      jsxs('div', { className: 'ao-hero-meta flex flex-wrap items-center gap-2 shrink-0', children: [
        jsx('span', {
          className: 'text-sm font-semibold ao-hero-glow',
          style: { color: ORB_STATE_COLORS[state] },
          children: word
        }),
        // what JARVIS is actually running + live elapsed — no silent-violet voids
        curCmd && jsx('span', {
          className: 'font-mono text-[0.6rem] text-(--ui-text-tertiary) max-w-[420px] truncate',
          title: curCmd,
          children: '· ' + curCmd + ' · ' + busySecs + 's'
        }),
        // brief green "done in Ns" flash when a command completes
        !curCmd && doneFlash && (Date.now() - doneFlash.at < 6000) && jsx('span', {
          className: 'font-mono text-[0.6rem] text-[#3fb950] max-w-[420px] truncate',
          title: doneFlash.cmd,
          children: '✓ ' + doneFlash.cmd + ' · ' + doneFlash.secs + 's'
        }),
        svcs.length > 0 && jsxs('button', {
          type: 'button',
          onClick: onOpenServices,
          title: 'Service health — click for details',
          className: 'flex items-center gap-1.5 font-mono text-[0.6rem] text-(--ui-text-quaternary) transition-colors hover:text-(--ui-accent)',
          children: [
            'SVC ',
            jsx('span', { style: { color: down > 0 ? '#f5495b' : '#3fb950' }, children: up + '/' + svcs.length }),
            // micro-LED strip: 6px dots per service
            jsx('span', { className: 'flex items-center gap-[3px] ml-1', children: svcs.slice(0, 30).map(s =>
              jsx('span', {
                className: 'inline-block rounded-full',
                style: {
                  width: 6, height: 6,
                  background: s.up === false ? '#f5495b' : s.up === true ? '#3fb950' : '#d29922',
                  boxShadow: s.up === false ? '0 0 6px #f5495b' : 'none',
                  animation: s.up === false ? 'aoPulse 1.5s ease-in-out infinite' : 'none'
                }
              }, s.name)
            )})
          ]
        }),
        jsx('span', { className: 'font-mono text-[0.6rem] text-(--ui-text-quaternary)', children: open + ' open' }),
        jsx('span', { className: 'font-mono text-[0.6rem] text-(--ui-text-quaternary)', children:
          now.toLocaleTimeString('en-US', { hour12: false })
        }),
        // faint area sparkline behind MTD revenue (falls back to a plain figure
        // when the series isn't available from the backend)
        revSeries && revSeries.length >= 2 ? jsx('span', { className: 'relative inline-flex items-center', style: { width: 48, height: 20 },
          children: [
            jsx(Spark, { data: revSeries, up: true, w: 48, h: 20 }),
            jsx('span', { className: 'absolute inset-0 flex items-center justify-center font-mono text-[0.55rem] text-(--ui-text-quaternary)', children: jsx(AnimNum, { value: metrics ? metrics.revenue_mtd : 0, prefix: '$', duration: 600 }) })
          ]
        }) : metrics && jsx('span', { className: 'font-mono text-[0.6rem] text-(--ui-text-quaternary)', children: 'MTD ' + fmtMoney(metrics.revenue_mtd) })
      ] }),
      // right side: protocol buttons
      jsxs('div', { className: 'ao-hero-actions flex flex-wrap items-center gap-1.5 ml-auto', children: [
        // full-viewport modes: Alt+1..4 (brief / console / graph / hud)
        jsxs('span', { className: 'ao-mode-sw flex items-center gap-1 mr-1', children: [
          ['brief', '1'], ['console', '2'], ['graph', '3'], ['hud', '4']
        ].map(([m, k]) => jsx('button', {
          type: 'button',
          className: cn('ao-kbd', (typeof window !== 'undefined' && window.__deckMode && window.__deckMode.mode === m) && 'border-(--ui-accent) text-(--ui-accent)'),
          title: 'Mode ' + k + ' — ' + m + ' (Alt+' + k + ')',
          onClick: () => { haptic('tap'); ModeStore.toggle(m) },
          children: k
        }, m))
        }),
        state === 'speaking' && jsx('button', {
          type: 'button',
          className: 'ao-runbtn border-(#f5495b)/50 text-(#f5495b)',
          onClick: stopJarvisSpeech,
          title: 'Stop voice playback (Esc also works)',
          children: ['⏹', 'stop']
        }),
        jsx('button', {
          type: 'button', className: 'ao-runbtn',
          onClick: () => { Chimes.play('up'); JarvisCtl.send('Generate my daily brief') },
          title: 'Run daily brief',
          children: [jsx('span', { className: 'text-(--ui-accent)', children: '◆' }), 'brief']
        }),
        jsx('button', {
          type: 'button', className: 'ao-runbtn',
          onClick: () => { Chimes.play('up'); JarvisCtl.send('What are my top 3 actions today?') },
          title: 'Top 3 actions',
          children: [jsx('span', { className: 'text-(--ui-accent)', children: '◆' }), 'top 3']
        }),
        jsx('button', {
          type: 'button', className: 'ao-runbtn',
          onClick: () => { Chimes.play('up'); JarvisCtl.send('Summarize service status') },
          title: 'Diagnostics',
          children: [jsx('span', { className: 'text-(--ui-accent)', children: '◆' }), 'diag']
        }),
        jsx('button', {
          type: 'button',
          className: 'ao-runbtn border-(--ui-accent)/40 text-(--ui-accent)',
          onClick: onOpenSpotlight,
          title: 'Open the command runner (Ctrl+J)',
          children: [jsx('span', { className: 'text-(--ui-accent)', children: '⌘' }), 'talk to jarvis']
        })
      ] })
    ]
  })
}

// ------------------------------------------------------------ agent activity + release board

function fmtAgo(isoOrMs) {
  // zoneless stamps (kanban sqlite text) are LOCAL — never append Z
  const t = typeof isoOrMs === 'number' ? isoOrMs / (isoOrMs > 1e11 ? 1 : 0.001)
    : Date.parse(String(isoOrMs))
  if (!isFinite(t)) return ''
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return m + 'm ago'
  const h = Math.floor(m / 60)
  if (h < 48) return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '') + ' ago'
  return Math.floor(h / 24) + 'd ago'
}

// ------------------------------------------------------------ service health drawer

function ServiceDrawer({ svcs, open, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return jsxs('div', {
    ref,
    className: 'ao-svc-drawer',
    'data-open': open ? '1' : '0',
    'aria-label': 'Service health drawer',
    role: 'dialog',
    children: [
      jsxs('div', { className: 'ao-svc-drawer-header', children: [
        jsx('span', { className: 'text-sm font-semibold text-(--ui-text-primary)', children: 'services' }),
        jsx('button', {
          type: 'button', onClick: onClose,
          className: 'text-xs text-(--ui-text-tertiary) hover:text-(--ui-accent)',
          'aria-label': 'Close services drawer',
          children: '\u2715'
        })
      ] }),
      jsx('div', { className: 'ao-svc-drawer-body', children: svcs.length === 0
        ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary) py-4 text-center', children: 'No service data.' })
        : jsx('div', { className: 'flex flex-col gap-2', children: svcs.map(s =>
          jsxs('div', {
            className: 'flex items-center gap-2 rounded-md px-2 py-2 text-sm border border-(--ui-stroke-secondary) bg-(--ui-tertiary-background)',
            children: [
              jsx('span', { className: 'shrink-0', children: jsx(Led, { up: s.up }) }),
              jsxs('div', { className: 'min-w-0 flex-1', children: [
                jsx('div', { className: 'text-(--ui-text-secondary) truncate', children: s.name }),
                jsxs('div', { className: 'flex items-center gap-2 text-[0.65rem] text-(--ui-text-quaternary)', children: [
                  s.updated && jsx('span', { children: s.updated }),
                  s.ms != null && jsx('span', { children: s.ms + 'ms' }),
                  s.up === false && s.detail && jsx('span', { className: 'truncate max-w-[120px]', children: s.detail })
                ] })
              ] }),
              jsx('button', {
                type: 'button',
                className: 'ao-btn text-[0.6rem]',
                'data-kind': 'restart',
                onClick: () => ConsoleStore.send('restart service ' + s.name),
                title: 'Restart ' + s.name,
                children: 'RESTART'
              })
            ]
          }, s.name)
        ) })
      })
    ]
  })
}

// ------------------------------------------------------------ hover-linking bus
// Scroll forensics — silent recorder for "the page moves by itself" reports.
// Hooks every programmatic scroll entry point, logs scroll events with
// isTrusted (untrusted = JS dispatch, trusted = native input), samples
// scrollY. window.__scrollProbeReport() returns the last 200 entries as JSON.
if (typeof window !== 'undefined' && !window.__scrollProbe) {
  const P = { log: [] }
  const stamp = (kind, extra) => {
    P.log.push({ t: Date.now(), y: Math.round(window.scrollY), kind, ...extra })
    if (P.log.length > 400) P.log.shift()
  }
  const hook = (obj, name) => {
    const orig = obj[name]
    if (!orig) return
    obj[name] = function (...a) {
      stamp('js:' + name, {
        args: a.map(x => (x && x.top !== undefined) ? ('top:' + x.top) : String(x)).slice(0, 2),
        stack: (new Error().stack || '').split('\n').slice(2, 5).join(' << ')
      })
      return orig.apply(this, a)
    }
  }
  hook(window, 'scrollTo')
  hook(window, 'scrollBy')
  hook(Element.prototype, 'scrollIntoView')
  hook(Element.prototype, 'focus')
  window.addEventListener('scroll', e => stamp('event', { trusted: e.isTrusted }), { passive: true })
  window.__scrollProbe = P
  window.__scrollProbeReport = () => JSON.stringify(P.log.slice(-200), null, 1)
}

const HoverBus = { topic: null, _subs: new Set(), subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn) },
  set(t) { this.topic = t; for (const fn of this._subs) { try { fn(t) } catch {} } },
  clear() { this.set(null) } }
if (typeof window !== 'undefined') window.__deckHover = HoverBus

const RUN_TONE = {
  completed: '#3fb950', success: '#3fb950', ok: '#3fb950',
  failed: '#f85149', error: '#f85149', incident: '#f85149',
  running: '#00e5ff', claimed: '#00e5ff', in_progress: '#00e5ff'
}

function RunDot({ status }) {
  const tone = RUN_TONE[(status || '').toLowerCase()] || '#64748b'
  const live = (status || '').toLowerCase() === 'running'
  return jsx('span', {
    className: 'inline-block h-1.5 w-1.5 rounded-full shrink-0',
    style: { background: tone, boxShadow: '0 0 6px ' + tone, animation: live ? 'aoPulse 1.1s ease-in-out infinite' : undefined }
  })
}

function AgentsCard() {
  const q = useQuery({
    queryKey: ['agentos', 'agents_activity'],
    queryFn: () => REST('/agents_activity'),
    refetchInterval: 120000
  })
  const d = q.data
  const cron = ((d && d.cron) || []).slice(0, 8)
  // board tasks intentionally NOT shown here — they already live on the Today
  // card and the To-Do/Tasks board; duplicating them made the overview noisy.
  const row = 'flex items-center gap-2 min-w-0 text-xs'
  return jsx(AoCard, {
    label: 'agent activity - last 48h',
    delay: 140,
    right: jsx('span', { className: 'text-xs text-(--ui-text-quaternary)', children: 'auto 2m' }),
    children: jsxs('div', { className: 'flex flex-col gap-3 overflow-y-auto', children: [
      q.isLoading && jsx(Skel, { h: '6rem' }),
      q.error && jsx('div', { className: 'text-xs text-(--ui-text-secondary)', children: 'activity feed offline' }),
      d && jsxs(Fragment, { children: [
        jsx('div', { className: 'ao-label', children: 'runs' }),
        jsx('div', { className: 'space-y-1.5', children: cron.length ? cron.map((r, i) =>
          jsxs('div', { className: row + ' ao-in', style: { animationDelay: i * 40 + 'ms' }, children: [
            jsx(RunDot, { status: r.status }),
            jsx('span', { className: 'truncate text-(--ui-text-secondary)', children: r.name }),
            r.outcome && jsx('span', { className: 'font-mono text-[10px] text-(--ui-text-quaternary)', children: r.outcome }),
            jsx('span', { className: 'ml-auto shrink-0 font-mono text-[10px] text-(--ui-text-quaternary)', children: fmtAgo(r.at) }),
            r.error && jsx('span', { title: r.error, className: 'shrink-0 text-[10px] text-[#f85149]', children: '!' })
          ] }, i)
        ) : jsx('div', { className: 'text-xs text-(--ui-text-quaternary)', children: 'no runs in the last 48h' }) })
      ] })
    ] })
  })
}

// release board retired — duplicated the projects & apps (status) card

// ------------------------------------------------------------ memory galaxy
// 3D memory galaxy: kanban tasks / cron jobs / services as a slowly rotating
// star cloud. Clusters by status; drag to rotate, wheel to zoom, click a star
// to pull a center line + detail readout. 2D canvas projection — no WebGL.

function _gHash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function _gRng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const GALAXY_RGB = {
  task_open: [92, 214, 255], task_done: [128, 138, 152],
  cron_ok: [126, 231, 135], cron_bad: [248, 81, 73],
  svc_up: [126, 231, 135], svc_down: [248, 81, 73],
}
function buildGalaxy(nodes, nowSec) {
  const byCluster = new Map()
  for (const n of nodes) {
    if (!byCluster.has(n.cluster)) byCluster.set(n.cluster, [])
    byCluster.get(n.cluster).push(n)
  }
  const keys = [...byCluster.keys()].sort()
  const GOLD = Math.PI * (3 - Math.sqrt(5))
  const out = []
  keys.forEach((ck, ci) => {
    const rng = _gRng(_gHash(ck))
    // golden-spiral anchor placement (stable order, spread over the sphere)
    const y = 1 - (2 * (ci + 0.5)) / keys.length
    const rr = Math.sqrt(Math.max(0, 1 - y * y))
    const th = GOLD * ci
    // enforce min shell radius ~0.5 so nodes never collide with central orb
    const shell = 0.5 + 0.44 * rng()
    const ax = Math.cos(th) * rr * shell, ay = y * shell, az = Math.sin(th) * rr * shell
    const list = byCluster.get(ck)
    const spread = 0.13 + 0.055 * Math.log2(1 + list.length)
    // per-cluster drift speed (deterministic from cluster name hash)
    const driftSpeed = ((_gHash(ck) % 997) / 997) * 0.003 + 0.001
    for (let ni = 0; ni < list.length; ni++) {
      const n = list[ni]
      const nr = _gRng(_gHash(n.id))
      const g = () => (nr() + nr() + nr()) / 1.5 - 1 // cheap gaussian-ish
      const ageDays = n.ts ? (nowSec - n.ts) / 86400 : 999
      const fresh = Math.max(0, 1 - ageDays / 30)
      const base = n.source === 'service' ? 2.8 : n.color_key === 'task_done' ? 1.4 : 2.0
      out.push({
        n,
        pos: [ax + g() * spread, ay + g() * spread * 0.8, az + g() * spread],
        anchor: [ax, ay, az],
        driftSpeed,
        size: base + fresh * (n.source === 'service' ? 0.6 : 1.8),
        alpha: n.color_key === 'task_done' ? 0.5 : 0.65 + fresh * 0.35,
        fresh,
        isAnchor: ni === 0,
      })
    }
  })
  return out
}
function MemoryGalaxy() {
  const q = useQuery({ queryKey: ['agentos', 'memory'], queryFn: () => REST('/memory'), refetchInterval: 120000 })
  const nodes = (q.data && q.data.nodes) || []
  const nowSec = Math.floor(Date.now() / 1000)
  const model = useMemo(() => buildGalaxy(nodes, nowSec), [nodes]) // eslint-disable-line
  const wrapRef = useRef(null)
  const cvRef = useRef(null)
  const [sel, setSel] = useState(null)
  const cam = useRef({ yaw: 0.6, pitch: 0.35, zoom: 1, auto: true })
  const ptr = useRef({ down: false, moved: 0, lx: 0, ly: 0, hov: -1, hx: 0, hy: 0 })
  const selRef = useRef(null)
  selRef.current = sel
  useEffect(() => {
    const cv = cvRef.current, wrap = wrapRef.current
    if (!cv || !wrap || !model.length) return
    const ctx = cv.getContext('2d')
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0, W = 0, H = 0, dpr = Math.min(devicePixelRatio || 1, 2), stop = false
    const accRaw = getComputedStyle(wrap).getPropertyValue('--ui-accent').trim()
    const acc01 = cssColorToRgb(accRaw) || [0.36, 0.84, 1]
    const accent = [Math.round(acc01[0] * 255), Math.round(acc01[1] * 255), Math.round(acc01[2] * 255)]
    const resize = () => {
      const r = wrap.getBoundingClientRect()
      W = Math.max(80, r.width); H = Math.max(80, r.height)
      cv.width = W * dpr; cv.height = H * dpr
      cv.style.width = W + 'px'; cv.style.height = H + 'px'
    }
    resize()
    const ro = new ResizeObserver(resize); ro.observe(wrap)
    const render = (ts) => {
      if (stop) return
      raf = requestAnimationFrame(render)
      const t = ts / 1000
      const c = cam.current
      if (c.auto && !reduced && !ptr.current.down) c.yaw += 0.0016
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.5 * c.zoom
      const cy_ = Math.cos(c.yaw), sy_ = Math.sin(c.yaw), cx_ = Math.cos(c.pitch), sx_ = Math.sin(c.pitch)
      const FOV = 2.4
      const P = [] // projected: [x, y, scale]
      const anchorP = new Map() // cluster -> [projX, projY] for energy lines
      const dims = new Float32Array(model.length).fill(1) // eased hover-dim state
      // Read hover bus for galaxy linking — token-based so "run wirepro
      // diagram pass" matches a node labeled "WirePro diagram-accuracy pass".
      const hoverTopic = HoverBus.topic
      const hoverTokens = hoverTopic ? String(hoverTopic).split(/\s+/).filter(w => w.length >= 4) : []
      for (const m of model) {
        // per-node orbital drift: slow yaw around Y axis, deterministic from cluster
        const driftAngle = m.driftSpeed * t
        const dca = Math.cos(driftAngle), dsa = Math.sin(driftAngle)
        const [ax, ay, az] = m.anchor
        const rx = ax * dca + az * dsa, rz = -ax * dsa + az * dca
        const dx = m.pos[0] - ax, dy = m.pos[1] - ay, dz = m.pos[2] - az
        const fx = rx + dx, fy = ay + dy, fz = rz + dz
        const x1 = fx * cy_ + fz * sy_, z1 = -fx * sy_ + fz * cy_
        const y2 = fy * cx_ - z1 * sx_, z2 = fy * sx_ + z1 * cx_
        const s = FOV / (FOV + z2)
        P.push([cx + x1 * s * R, cy + y2 * s * R, s])
        if (m.isAnchor) {
          const ax1 = rx * cy_ + rz * sy_, az1 = -rx * sy_ + rz * cy_
          const ay2 = ay * cx_ - az1 * sx_, az2 = ay * sx_ + az1 * cx_
          const as = FOV / (FOV + az2)
          anchorP.set(m.n.cluster, [cx + ax1 * as * R, cy + ay2 * as * R])
        }
      }
      // cluster gravity links (anchor is the cluster centroid — reuse first node's dir)
      ctx.lineWidth = 1
      // selected: center line first (under points)
      const si = model.findIndex(m => m.n.id === (selRef.current && selRef.current.id))
      if (si >= 0) {
        ctx.strokeStyle = `rgba(${accent[0]},${accent[1]},${accent[2]},0.85)`
        ctx.setLineDash([4, 4])
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(P[si][0], P[si][1]); ctx.stroke()
        ctx.setLineDash([])
      }
      // --- orb-galaxy energy lines (state-reactive) ---
      const orbSt = OrbBus.state
      const orbLvl = OrbBus.level()
      if (anchorP.size > 0) {
        if (orbSt === 'thinking' || orbSt === 'working') {
          // pulsing violet data-flow lines from orb center to cluster anchors
          let ai = 0
          for (const [, [ax, ay]] of anchorP) {
            const phase = (t * 2 + ai * 0.7) % (Math.PI * 2)
            const alpha = 0.15 + 0.25 * (Math.sin(phase) * 0.5 + 0.5)
            ctx.lineWidth = 1.2
            ctx.strokeStyle = `rgba(168,85,247,${alpha.toFixed(3)})`
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ax, ay); ctx.stroke()
            ai++
          }
        } else if (orbSt === 'speaking') {
          // speech: outward pulse from orb along anchor rays
          let ai = 0
          for (const [, [ax, ay]] of anchorP) {
            const dx = ax - cx, dy = ay - cy
            const phase = (t * 3 + ai * 0.9) % 1
            const pulse = Math.sin(phase * Math.PI * 2) * 0.5 + 0.5
            const alpha = 0.08 + pulse * 0.35 * orbLvl
            ctx.lineWidth = 1 + pulse * 1.5
            ctx.strokeStyle = `rgba(168,85,247,${alpha.toFixed(3)})`
            ctx.beginPath()
            ctx.moveTo(cx + dx * (1 - pulse * 0.15), cy + dy * (1 - pulse * 0.15))
            ctx.lineTo(ax, ay)
            ctx.stroke()
            ai++
          }
        } else if (orbSt === 'idle') {
          // faint static connections
          ctx.lineWidth = 0.5
          for (const [, [ax, ay]] of anchorP) {
            ctx.strokeStyle = `rgba(90,100,120,0.06)`
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ax, ay); ctx.stroke()
          }
        }
      }
      // points: halo pass then core pass
      for (let i = 0; i < model.length; i++) {
        const m = model[i], [px, py, s] = P[i]
        const rgb = m.n.color_key === 'task_open' ? accent : (GALAXY_RGB[m.n.color_key] || [160, 170, 185])
        const selI = i === si
        const hovI = i === ptr.current.hov
        // Hover-linking: any >=4-char token from the hovered item title that
        // appears in the node's label or cluster lights that node up.
        const linkMatch = hoverTokens.length > 0 &&
          hoverTokens.some(w => ((m.n.label || '') + ' ' + (m.n.cluster || '')).toLowerCase().includes(w))
        const hoverTarget = hoverTokens.length > 0 && !linkMatch ? 0.15 : 1
        // ease each node's dim toward its target (~200ms at 60fps) instead of snapping
        const dimCur = dims[i] === undefined ? 1 : dims[i]
        const dimEased = Math.abs(dimCur - hoverTarget) < 0.01 ? hoverTarget : dimCur + (hoverTarget - dimCur) * 0.2
        dims[i] = dimEased
        const r = m.size * (1.1 + 0.6 * s) * (selI ? 1.7 : hovI ? 1.35 : linkMatch ? 1.25 : 1)
        const a = m.alpha * (selI ? 1 : hovI ? 1.2 : 1) * dimEased
        ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(a * 0.16).toFixed(3)})`
        ctx.beginPath(); ctx.arc(px, py, r * 3.2, 0, 6.2832); ctx.fill()
        ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.min(1, a).toFixed(3)})`
        ctx.beginPath(); ctx.arc(px, py, r, 0, 6.2832); ctx.fill()
        if (selI || hovI) {
          ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.9)`
          ctx.beginPath(); ctx.arc(px, py, r + 4 + (selI ? Math.sin(t * 4) * 1.5 : 0), 0, 6.2832); ctx.stroke()
        }
      }
      // hover tooltip
      if (ptr.current.hov >= 0) {
        const m = model[ptr.current.hov]
        const label = m.n.label || m.n.id
        ctx.font = '11px ui-monospace, monospace'
        const tw = ctx.measureText(label).width + 14
        let tx = ptr.current.hx + 10, ty = ptr.current.hy - 8
        if (tx + tw > W - 6) tx = ptr.current.hx - tw - 10
        ctx.fillStyle = 'rgba(10,14,20,0.92)'
        ctx.strokeStyle = `rgba(${accent[0]},${accent[1]},${accent[2]},0.5)`
        ctx.beginPath(); ctx.roundRect(tx, ty - 12, tw, 20, 5); ctx.fill(); ctx.stroke()
        ctx.fillStyle = 'rgba(230,238,246,0.95)'
        ctx.fillText(label, tx + 7, ty + 2)
      }
      ptr.current.px = P // keep for hit tests
    }
    raf = requestAnimationFrame(render)
    const hit = (mx, my) => {
      const P = ptr.current.px || []
      let best = -1, bd = 144
      for (let i = 0; i < P.length && i < model.length; i++) {
        const dx = P[i][0] - mx, dy = P[i][1] - my, d = dx * dx + dy * dy
        if (d < bd) { bd = d; best = i }
      }
      return best
    }
    const onMove = (e) => {
      const r = cv.getBoundingClientRect()
      const mx = e.clientX - r.left, my = e.clientY - r.top
      const p = ptr.current
      if (p.down) {
        cam.current.yaw += (e.clientX - p.lx) * 0.006
        cam.current.pitch = Math.max(-1.2, Math.min(1.2, cam.current.pitch + (e.clientY - p.ly) * 0.005))
        p.moved += Math.abs(e.clientX - p.lx) + Math.abs(e.clientY - p.ly)
        p.lx = e.clientX; p.ly = e.clientY
      }
      p.hx = mx; p.hy = my
      p.hov = p.down ? -1 : hit(mx, my)
      cv.style.cursor = p.hov >= 0 ? 'pointer' : p.down ? 'grabbing' : 'grab'
    }
    const onDown = (e) => { if (e.button !== 0) return; const p = ptr.current; p.down = true; p.moved = 0; p.lx = e.clientX; p.ly = e.clientY; cv.setPointerCapture(e.pointerId) }
    const onUp = (e) => {
      const p = ptr.current; p.down = false
      if (p.moved < 6) {
        const r = cv.getBoundingClientRect()
        const i = hit(e.clientX - r.left, e.clientY - r.top)
        setSel(i >= 0 ? model[i].n : null)
      }
    }
    // Wheel over the map zooms ONLY with Ctrl/Meta held; otherwise let the page
    // scroll normally (preventDefault here made the page feel dead under the cursor).
    const onWheel = (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); cam.current.zoom = Math.max(0.55, Math.min(2.4, cam.current.zoom * (e.deltaY > 0 ? 0.92 : 1.08))) }
    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerdown', onDown)
    cv.addEventListener('pointerup', onUp)
    cv.addEventListener('wheel', onWheel, { passive: false })
    return () => { stop = true; cancelAnimationFrame(raf); ro.disconnect(); cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointerup', onUp); cv.removeEventListener('wheel', onWheel) }
  }, [model])
  const fmtTs = (ts) => {
    if (!ts) return ''
    const d = new Date(ts * 1000)
    const ago = (Date.now() - d.getTime()) / 60000
    if (ago < 1) return 'now'; if (ago < 60) return `${Math.round(ago)}m ago`
    if (ago < 1440) return `${Math.round(ago / 60)}h ago`
    return `${Math.round(ago / 1440)}d ago`
  }
  const legend = jsx('div', { style: { position: 'absolute', left: 10, bottom: 8, display: 'flex', gap: 12, fontSize: 10, opacity: 0.75, pointerEvents: 'none' },
    children: [
      jsx('span', { children: '\u25CF tasks' }),
      jsx('span', { style: { color: '#7ee787' }, children: '\u25CF cron/services' }),
      jsx('span', { style: { color: '#f85149' }, children: '\u25CF failing' }),
      jsx('span', { style: { color: 'var(--ui-text-tertiary)' }, children: '\u25CF done' }),
      jsx('span', { style: { marginLeft: 'auto', opacity: 0.7 }, children: nodes.length + ' nodes \u00B7 drag \u00B7 ctrl+wheel \u00B7 click' })
    ] })
  // selected node -> live action panel (same actions as the 3D renderer)
  const detail = !sel ? null : jsx(GalaxyNodeActions, { node: sel, onClose: () => setSel(null) })
  const detailMeta = !sel ? null : jsx('div', { style: { position: 'absolute', right: 10, top: 92, maxWidth: '62%', fontSize: 10, opacity: 0.75, pointerEvents: 'none' },
    children: 'last activity: ' + (fmtTs(sel.ts) || 'unknown') })
  return jsx('div', { style: { position: 'relative', width: '100%', height: '100%', minHeight: 260 }, ref: wrapRef,
    children: [
      jsx('canvas', { ref: cvRef, 'aria-label': 'memory galaxy', style: { display: 'block', touchAction: 'none' } }),
      legend,
      detail,
      detailMeta
    ] })
}

// ------------------------------------------------------------ galaxy node actions
// One action panel shared by the 2D and 3D galaxy: click a node anywhere and
// get real actions for it (delegate to JARVIS, restart a service, run a cron).
// Everything routes through ConsoleStore.send — the proven command path — so
// no new backend surface is needed.

function galaxyActionsFor(node) {
  const label = node.label || node.id
  if (node.source === 'service') {
    return [
      { label: 'restart', title: 'Delegate the restart to JARVIS', cmd: 'restart service ' + label },
      { label: 'diagnose', title: 'Ask JARVIS why it is down', cmd: 'diagnose why the ' + label + ' service is down and report what you find' }
    ]
  }
  if (node.source === 'cron') {
    return [
      { label: 'run now', title: 'Run this cron job right now', cmd: 'run the cron job "' + label + '" right now and report the outcome' },
      { label: 'details', title: 'Show last runs + schedule', cmd: 'show me the schedule and last 3 runs of the cron job "' + label + '"' }
    ]
  }
  // tasks (kanban / telegram)
  const acts = [
    { label: 'done', title: 'Mark this task done via JARVIS', cmd: 'mark the task "' + label + '" as done on my board' },
    { label: 'break down', title: 'Ask JARVIS to break it into steps', cmd: 'break this task into concrete ordered steps and add them to my list: ' + label },
    { label: 'delegate', title: 'Hand the whole thing to JARVIS', cmd: label }
  ]
  return acts
}

function GalaxyNodeActions({ node, onClose }) {
  if (!node) return null
  const acts = galaxyActionsFor(node)
  return jsx('div', {
    style: { position: 'absolute', right: 10, top: 8, maxWidth: '68%', zIndex: 30,
      padding: '8px 10px', borderRadius: 8, background: 'rgba(10,14,20,0.94)',
      border: '1px solid var(--ui-stroke-secondary)', pointerEvents: 'auto' },
    children: [
      jsxs('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 }, children: [
        jsx('div', { style: { fontWeight: 600, fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: node.label || node.id }),
        jsx('button', { type: 'button', onClick: onClose, title: 'Close', 'aria-label': 'Close node actions',
          style: { marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--ui-text-quaternary)', cursor: 'pointer', fontSize: 11 },
          children: '\u00D7' })
      ] }),
      jsx('div', { style: { opacity: 0.7, fontSize: 10, margin: '2px 0 6px' },
        children: [node.source, node.status, node.assignee, node.detail].filter(Boolean).join(' \u00B7 ') }),
      jsxs('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 5 }, children: [
        acts.map((a, i) => jsx('button', {
          type: 'button',
          className: 'ao-btn',
          title: a.title,
          onClick: () => { haptic('tap'); Chimes.play('up'); onClose(); ConsoleStore.send(a.cmd) },
          children: a.label
        }, i)),
        jsx('span', { style: { marginLeft: 'auto', alignSelf: 'center', font: '400 9px ui-monospace, monospace', color: 'var(--ui-text-quaternary)' }, children: 'via JARVIS' })
      ] })
    ]
  })
}

// ------------------------------------------------------------ memory galaxy 3D
// three.js renderer for the same buildGalaxy model the 2D canvas uses: real
// depth, per-node point sprites, cluster explode (slider spreads every cluster
// outward from its anchor) and the same click -> GalaxyNodeActions flow.
// ServiceDrawer opener bus: card rows (StatusCard, galaxy nodes) can pop the
// existing services drawer without prop-drilling through the widget grid.
const DrawerBus = {
  _subs: new Set(),
  open(name) { this.last = name || null; for (const f of this._subs) { try { f(this.last) } catch { /* ignore */ } } },
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn) },
  last: null
}

// ------------------------------------------------------------ neural core (merged orb + galaxy center stage)

function NeuralCore({ onOpenSpotlight }) {
  const [spotOpen, setSpotOpen] = useState(false)
  const [state, setState] = useState(OrbBus.state)
  useEffect(() => OrbBus.subscribe(setState), [])
  return jsxs('div', {
    style: { position: 'relative', width: '100%', height: '100%', minHeight: 380 },
    children: [
      jsx(MemoryGalaxy, {}),
      // Orb overlaid dead-center with circular fade vignette
      jsx('div', {
        style: {
          position: 'absolute', left: '50%', top: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          pointerEvents: 'none',
          width: 200,
          height: 200,
        },
        children: [
          // Subtle circular fade mask
          jsx('div', {
            style: {
              position: 'absolute', inset: 0, borderRadius: '50%',
              background: 'radial-gradient(circle, transparent 45%, rgba(0,0,0,0.35) 100%)',
              pointerEvents: 'none', zIndex: 2,
            }
          }),
          jsx('div', {
            style: {
              position: 'absolute', left: '50%', top: '50%',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'auto', cursor: 'pointer',
            },
            onClick: () => { haptic('tap'); onOpenSpotlight() },
            title: 'Click to open command runner (Ctrl+J)',
            children: jsx(Orb3D, { size: 200, onClick: () => { haptic('tap'); onOpenSpotlight() }, ariaLabel: ORB_LABELS[state] || 'Neural core' })
          })
        ]
      })
    ]
  })
}

// ------------------------------------------------------------ customizable widget grid

// ------------------------------------------------------------ automation (self-healing) + memory cards

const REM_KIND = {
  auto_fixed:      { icon: '✓', color: '#3fb950' },
  approved_fixed:  { icon: '✓', color: '#3fb950' },
  recovered:       { icon: '↻', color: '#3fb950' },
  auto_failed:     { icon: '✕', color: '#f5495b' },
  approved_failed: { icon: '✕', color: '#f5495b' },
  denied:          { icon: '–', color: '#64748b' }
}

function AutomationCard() {
  const q = useQuery({
    queryKey: ['agentos', 'remediation'],
    queryFn: () => REST('/remediation'),
    refetchInterval: 60000
  })
  const [busy, setBusy] = useState('')
  const d = q.data
  const pending = (d && d.pending) || []
  const events = (d && d.events) || []
  const enabled = !!(d && d.enabled)
  const [openEv, setOpenEv] = useState(null)
  // In-place status for DIAGNOSE & FIX / RESTART (Nielsen #1 — visibility of
  // system status): the command runs through ConsoleStore (console card + orb
  // show progress) but THIS card must show what's happening where you clicked.
  const [evAct, setEvAct] = useState(null)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!evAct || evAct.state !== 'working') return
    const t = setInterval(() => tick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [evAct && evAct.id, evAct && evAct.state])

  async function runFix(ev, cmd, verb) {
    if (evAct && evAct.state === 'working') return
    if (ConsoleStore.busy) {
      setEvAct({ id: ev.id, verb, state: 'error', note: 'another command is still running — watch the console', secs: 0, start: Date.now() })
      return
    }
    const start = Date.now()
    setEvAct({ id: ev.id, verb, state: 'working', start })
    const ok = await ConsoleStore.send(cmd)
    const last = ConsoleStore.msgs[ConsoleStore.msgs.length - 1]
    const note = last && last.role === 'jarvis' ? last.text : (ok ? 'done' : 'command failed')
    setEvAct({ id: ev.id, verb, state: ok ? 'done' : 'error', note: note.length > 110 ? note.slice(0, 109) + '\u2026' : note, secs: Math.max(1, Math.round((Date.now() - start) / 1000)), start })
  }

  async function act(path, body, tag) {
    setBusy(tag)
    try {
      await REST(path, { method: 'POST', body })
      await q.refetch()
    } catch (e) { /* card shows next poll's truth */ }
    setBusy('')
  }

  return jsx(AoCard, {
    label: 'automation - self-healing',
    delay: 150,
    right: jsxs('button', {
      type: 'button',
      onClick: () => act('/remediation/config', { enabled: !enabled }, 'toggle'),
      title: 'Auto-fix allowlisted services without asking',
      className: 'ao-runbtn',
      style: { color: enabled ? '#3fb950' : 'var(--ui-text-quaternary)' },
      children: ['AUTO-FIX ', enabled ? 'ON' : 'OFF']
    }),
    children: jsxs('div', { className: 'flex flex-col gap-2 overflow-y-auto', children: [
      q.isLoading && jsx(Skel, { h: '5rem' }),
      q.error && jsx('div', { className: 'text-xs text-(--ui-text-secondary)', children: 'automation feed offline' }),
      pending.length > 0 && jsx('div', { className: 'ao-label text-[#f5495b]', children: 'awaiting approval' }),
      pending.map((p, i) => jsxs('div', {
        className: 'ao-in rounded-md border border-[#f5495b]/30 bg-[#f5495b]/5 px-2.5 py-2',
        style: { animationDelay: i * 40 + 'ms' },
        children: [
          jsxs('div', { className: 'flex items-center gap-2 text-xs', children: [
            jsx('span', { style: { color: '#f5495b' }, children: '●' }),
            jsx('span', { className: 'font-semibold truncate', children: p.service + ' is down' }),
            jsx('span', { className: 'ml-auto shrink-0 font-mono text-[10px] text-(--ui-text-quaternary)', children: fmtAgo(p.created) })
          ] }),
          p.detail && jsx('div', { className: 'mt-0.5 truncate font-mono text-[10px] text-(--ui-text-quaternary)', children: p.detail }),
          jsxs('div', { className: 'mt-1.5 flex items-center gap-1.5', children: [
            jsx('button', {
              type: 'button', className: 'ao-btn', disabled: busy !== '',
              onClick: () => act('/remediation/approve', { id: p.id }, 'app' + p.id),
              children: busy === 'app' + p.id ? 'fixing…' : 'APPROVE'
            }),
            jsx('button', {
              type: 'button', className: 'ao-btn', disabled: busy !== '',
              onClick: () => act('/remediation/deny', { id: p.id }, 'deny' + p.id),
              children: 'DENY'
            }),
            jsx('span', { className: 'ml-auto font-mono text-[10px] text-(--ui-text-quaternary)', children: p.cmd ? 'restart cmd ready' : 'agent will diagnose' })
          ] })
        ]
      }, p.id)),
      jsx('div', { className: 'ao-label', children: 'activity' }),
      jsx('div', { className: 'space-y-1.5', children: events.length ? events.slice(0, 8).map((ev, i) => {
        const failed = ev.kind === 'auto_failed' || ev.kind === 'approved_failed'
        const open = openEv === ev.id
        return jsxs('div', { className: 'ao-in rounded-md transition-colors ' + (open ? 'border border-(--ui-stroke-secondary) bg-[rgba(6,10,16,.45)] px-2 py-1.5' : 'cursor-pointer px-0.5 py-0.5 hover:bg-[rgba(92,214,255,.05)]'), style: { animationDelay: i * 40 + 'ms' },
          onClick: () => { if (!open) Chimes.play('tap'); setOpenEv(open ? null : ev.id) },
          title: open ? '' : 'Click for details',
          children: [
            jsxs('div', { className: 'flex items-center gap-2 min-w-0 text-xs', children: [
              jsx('span', { className: 'shrink-0', style: { color: (REM_KIND[ev.kind] || {}).color || '#64748b' }, children: (REM_KIND[ev.kind] || {}).icon || '•' }),
              jsx('span', { className: 'truncate text-(--ui-text-secondary)', children: ev.service }),
              jsx('span', { className: 'truncate font-mono text-[10px] text-(--ui-text-quaternary)', children: ev.kind.replace('_', ' ') }),
              jsx('span', { className: 'ml-auto shrink-0 font-mono text-[10px] text-(--ui-text-quaternary)', children: fmtAgo(ev.at) })
            ] }),
            open && jsxs(Fragment, { children: [
              ev.detail && jsx('div', { className: 'mt-1.5 whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-(--ui-text-tertiary)', children: ev.detail }),
              failed && (evAct && evAct.id === ev.id ? jsx('div', {
                className: 'mt-2 cursor-pointer font-mono text-[10px] leading-relaxed',
                style: { color: evAct.state === 'working' ? '#5cd6ff' : evAct.state === 'done' ? '#3fb950' : '#f5495b' },
                onClick: e => { e.stopPropagation(); setEvAct(null) },
                title: 'Click to dismiss \u2014 full detail in the console',
                children: evAct.state === 'working'
                  ? jsxs(Fragment, { children: [
                      jsx('span', { className: 'ao-led', style: { marginRight: 6, verticalAlign: 'middle' } }),
                      'JARVIS is ' + evAct.verb + ' the ' + ev.service + ' service\u2026 ' + Math.round((Date.now() - evAct.start) / 1000) + 's'
                    ] })
                  : (evAct.state === 'done'
                      ? '\u2713 ' + evAct.verb.replace(/ing$/, 'ed') + ' in ' + evAct.secs + 's \u2014 ' + evAct.note
                      : '\u2715 ' + evAct.note)
              }) : jsxs('div', { className: 'mt-2 flex items-center gap-1.5', children: [
                jsx('button', {
                  type: 'button', className: 'ao-btn text-[10px]',
                  onClick: e => { e.stopPropagation(); Chimes.play('up'); runFix(ev, 'diagnose why the ' + ev.service + ' service is down \u2014 find the root cause, fix it, confirm it\u2019s healthy again, and report back what was wrong', 'diagnosing') },
                  children: '🔧 DIAGNOSE & FIX'
                }),
                jsx('button', {
                  type: 'button', className: 'ao-btn text-[10px]',
                  onClick: e => { e.stopPropagation(); Chimes.play('up'); runFix(ev, 'restart the ' + ev.service + ' service and confirm it comes back healthy', 'restarting') },
                  children: '🔄 RESTART'
                })
              ] }))
            ] })
          ] }, ev.id)
      }) : jsx('div', { className: 'text-xs text-(--ui-text-quaternary)', children: 'no events yet — scanner runs every 5 min' }) })
    ] })
  })
}

function MemoryCard() {
  const q = useQuery({
    queryKey: ['agentos', 'memfacts'],
    queryFn: () => REST('/memfacts'),
    refetchInterval: 120000
  })
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const d = q.data
  const facts = (d && d.facts) || []

  async function add() {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      await REST('/memfacts', { method: 'POST', body: { text: t } })
      setText('')
      await q.refetch()
    } catch (e) { /* next poll shows truth */ }
    setBusy(false)
  }
  async function drop(id) {
    if (busy) return
    setBusy(true)
    try { await REST('/memfacts', { method: 'DELETE', body: { id } }); await q.refetch() } catch (e) { /* ignore */ }
    setBusy(false)
  }

  return jsx(AoCard, {
    label: 'memory - jarvis remembers',
    delay: 160,
    right: jsx('span', { className: 'text-xs text-(--ui-text-quaternary)', children: (d && d.total || 0) + ' facts' }),
    children: jsxs('div', { className: 'flex flex-col gap-2 min-h-0', children: [
      jsxs('div', { className: 'flex items-center gap-1.5', children: [
        jsx('input', {
          value: text,
          onChange: e => setText(e.target.value),
          onKeyDown: e => { if (e.key === 'Enter') add() },
          placeholder: 'remember that…',
          className: 'min-w-0 flex-1 rounded-md border border-(--ui-border) bg-transparent px-2.5 py-1.5 text-xs text-(--ui-text-primary) outline-none placeholder:text-(--ui-text-quaternary) focus:border-(--ui-accent)',
          spellCheck: false
        }),
        jsx('button', { type: 'button', className: 'ao-btn', onClick: add, disabled: busy, children: busy ? '…' : 'ADD' })
      ] }),
      jsx('div', { className: 'flex-1 space-y-1.5 overflow-y-auto', children: facts.length ? facts.slice(0, 12).map((f, i) =>
        jsxs('div', { className: 'group flex items-center gap-2 min-w-0 text-xs ao-in', style: { animationDelay: i * 30 + 'ms' }, children: [
          jsx('span', { className: 'shrink-0 text-(--ui-accent)', children: '◆' }),
          jsx('span', { className: 'min-w-0 flex-1 truncate text-(--ui-text-secondary)', title: f.text, children: f.text }),
          jsx('button', {
            type: 'button',
            onClick: () => drop(f.id),
            title: 'Forget this',
            className: 'shrink-0 text-[10px] text-(--ui-text-quaternary) opacity-0 transition-opacity group-hover:opacity-100 hover:text-[#f5495b]',
            children: '✕'
          })
        ] }, f.id)
      ) : jsx('div', { className: 'text-xs text-(--ui-text-quaternary)', children: 'nothing stored yet — say "remember that…" to JARVIS or add above' }) })
    ] })
  })
}

// ------------------------------------------------------------ settings

// localStorage number kept in sync across deck windows (the HUD companion is a
// second BrowserWindow on the same origin) via the standard storage event.
function useSharedNum(key, def) {
  const read = () => {
    try {
      const n = JSON.parse(localStorage.getItem(key))
      return typeof n === 'number' ? n : def
    } catch { return def }
  }
  const [v, setV] = useState(read)
  useEffect(() => {
    const onStorage = e => { if (e.key === key) setV(read()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = nv => {
    const clamped = Math.max(0, Math.min(1, Number(nv) || 0))
    setV(clamped)
    try { localStorage.setItem(key, JSON.stringify(clamped)) } catch { /* ignore */ }
  }
  return [v, set]
}

const TTS_VOICES = [
  ['', 'Deck default (agentos.yaml)'],
  ['en-GB-RyanNeural', 'Ryan — British male'],
  ['en-GB-SoniaNeural', 'Sonia — British female'],
  ['en-US-GuyNeural', 'Guy — American male'],
  ['en-US-AriaNeural', 'Aria — American female'],
  ['en-AU-NatashaNeural', 'Natasha — Australian female'],
  ['fish:612b878b113047d9a770c069c8b4fdfe', 'Jarvis (MCU) — Fish Audio'],
]

function SettingsSection() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['agentos', 'settings'], queryFn: () => REST('/settings') })
  const cq = useQuery({ queryKey: ['agentos', 'connectors'], queryFn: () => REST('/connectors'), refetchInterval: 120000 })
  const [accent, setAccent] = useLocal('agentos-accent', null)
  const [hudOp, setHudOp] = useSharedNum('agentos-hud-opacity', 1)
  const [ttsVol, setTtsVol] = useSharedNum('agentos-tts-vol', 1)
  const [chimesOff, setChimesOff] = useState(() => { try { return localStorage.getItem('agentos-chimes') === 'off' } catch { return false } })
  const d = q.data
  const [voice, setVoice] = useState('')
  const [voiceSaved, setVoiceSaved] = useState('')
  useEffect(() => { if (d && d.settings) { setVoice(d.settings.tts_voice || ''); setVoiceSaved(d.settings.tts_voice || '') } }, [d])
  const [keyDrafts, setKeyDrafts] = useState({})
  const [keyBusy, setKeyBusy] = useState(null)
  const [keyMsg, setKeyMsg] = useState(null)
  const [connBusy, setConnBusy] = useState(null)
  const [connMsg, setConnMsg] = useState(null)

  async function saveVoice() {
    try {
      await REST('/settings', { method: 'POST', body: { tts_voice: voice } })
      setVoiceSaved(voice)
      qc.invalidateQueries({ queryKey: ['agentos', 'settings'] })
    } catch (e) { setKeyMsg('voice: ' + String(e && e.message || e).slice(0, 120)) }
  }

  async function saveKey(name) {
    const value = (keyDrafts[name] || '').trim()
    if (!value || keyBusy) return
    setKeyBusy(name)
    setKeyMsg(null)
    try {
      await REST('/settings/keys', { method: 'POST', body: { name, value } })
      setKeyDrafts(m => ({ ...m, [name]: '' }))
      setKeyMsg(name + ' saved to ~/.hermes/agentos/.env')
      await qc.invalidateQueries({ queryKey: ['agentos', 'settings'] })
    } catch (e) {
      setKeyMsg(name + ': ' + String(e && e.message || e).slice(0, 140))
    } finally { setKeyBusy(null) }
  }

  async function connectConnector(name) {
    setConnBusy(name)
    setConnMsg(null)
    try {
      const r = await REST('/connectors/connect', { method: 'POST', body: { name } })
      if (r && r.url) openExternal(r.url)
      else setConnMsg('no authorization URL returned')
    } catch (e) {
      setConnMsg(String(e && e.message || e).slice(0, 160))
    } finally { setConnBusy(null) }
  }

  async function deleteKey(name) {
    if (keyBusy) return
    setKeyBusy(name)
    setKeyMsg(null)
    try {
      await REST('/settings/keys', { method: 'DELETE', body: { name } })
      setKeyMsg(name + ' removed from .env')
      await qc.invalidateQueries({ queryKey: ['agentos', 'settings'] })
    } catch (e) {
      setKeyMsg(name + ': ' + String(e && e.message || e).slice(0, 140))
    } finally { setKeyBusy(null) }
  }

  const [customName, setCustomName] = useState('')
  const [customVal, setCustomVal] = useState('')
  async function addCustomKey() {
    const name = customName.trim().toUpperCase()
    const value = customVal.trim()
    if (!name || !value || keyBusy) return
    setKeyBusy('__custom')
    setKeyMsg(null)
    try {
      await REST('/settings/keys', { method: 'POST', body: { name, value } })
      setCustomName(''); setCustomVal('')
      setKeyMsg(name + ' saved to ~/.hermes/agentos/.env')
      await qc.invalidateQueries({ queryKey: ['agentos', 'settings'] })
    } catch (e) {
      setKeyMsg(name + ': ' + String(e && e.message || e).slice(0, 140))
    } finally { setKeyBusy(null) }
  }

  const hosted = (cq.data && cq.data.hosted) || []
  const mcps = (cq.data && cq.data.mcps) || []
  const pct = v => Math.round(v * 100) + '%'

  return jsxs('div', { className: 'mx-auto flex w-full max-w-4xl flex-col gap-3', children: [
    // ---- appearance
    jsx(AoCard, {
      label: 'appearance & sound', delay: 40,
      children: jsxs('div', { className: 'grid gap-4 sm:grid-cols-2', children: [
        jsxs('div', { className: 'space-y-3', children: [
          jsxs('div', { children: [
            jsxs('div', { className: 'mb-1 flex items-baseline justify-between', children: [
              jsx('span', { className: 'ao-label', children: 'hud transparency' }),
              jsx('span', { className: 'font-mono text-[0.7rem] text-(--ui-text-tertiary)', children: pct(hudOp) })
            ] }),
            jsx('input', {
              type: 'range', min: 0.25, max: 1, step: 0.05, value: hudOp,
              onChange: e => setHudOp(e.target.value),
              className: 'ao-range', 'aria-label': 'HUD transparency'
            })
          ] }),
          jsxs('div', { children: [
            jsxs('div', { className: 'mb-1 flex items-baseline justify-between', children: [
              jsx('span', { className: 'ao-label', children: 'voice volume' }),
              jsx('span', { className: 'font-mono text-[0.7rem] text-(--ui-text-tertiary)', children: pct(ttsVol) })
            ] }),
            jsx('input', {
              type: 'range', min: 0, max: 1, step: 0.05, value: ttsVol,
              onChange: e => { setTtsVol(e.target.value); Tts.setVolume(e.target.value) },
              className: 'ao-range', 'aria-label': 'Voice volume'
            })
          ] }),
          jsx('button', {
            type: 'button',
            className: cn('ao-btn', !chimesOff && 'border-(--ui-accent) text-(--ui-accent)'),
            onClick: () => {
              const next = !chimesOff
              setChimesOff(next)
              try { localStorage.setItem('agentos-chimes', next ? 'off' : 'on') } catch { /* ignore */ }
              if (!next) Chimes.play('up')
            },
            'aria-pressed': String(!chimesOff),
            children: chimesOff ? 'Chimes: off' : 'Chimes: on'
          })
        ] }),
        jsxs('div', { className: 'space-y-3', children: [
          jsxs('div', { children: [
            jsx('div', { className: 'ao-label mb-1.5', children: 'accent theme' }),
            jsxs('div', { className: 'flex items-center gap-2', children: [
              Object.entries(AO_THEMES).map(([name, col]) =>
                jsx('span', {
                  className: 'ao-dot',
                  'data-active': accent === name ? '1' : '0',
                  style: { background: col, color: col },
                  onClick: () => { haptic('tap'); setAccent(accent === name ? null : name) },
                  title: name
                }, name)
              ),
              jsx('button', { type: 'button', className: 'ao-wbtn', title: 'Reset to deck default', onClick: () => setAccent(null), children: '↺' })
            ] })
          ] }),
          jsxs('div', { children: [
            jsx('div', { className: 'ao-label mb-1.5', children: 'jarvis voice' }),
            jsxs('div', { className: 'flex items-center gap-2', children: [
              jsx('select', {
                className: 'ao-select flex-1', value: voice,
                onChange: e => setVoice(e.target.value),
                'aria-label': 'Jarvis voice',
                children: TTS_VOICES.map(([val, label]) => jsx('option', { value: val, children: label }, val))
              }),
              voice !== voiceSaved && jsx('button', { type: 'button', className: 'ao-btn', onClick: saveVoice, children: 'Save' })
            ] })
          ] }),
          jsx('button', {
            type: 'button', className: 'ao-btn',
            onClick: () => {
              // test the SELECTED voice, not the saved one — and surface
              // provider errors (e.g. missing FISH_API_KEY) as a visible message
              Tts.ack('Testing, one two three. Standing by, sir.', voice || undefined)
              fetch('/api/plugins/agentos/tts?ack=1&text=ping' + (voice ? '&voice=' + encodeURIComponent(voice) : ''))
                .then(r => { if (!r.ok) return r.json().then(j => { throw new Error(j.detail || r.status) }).catch(() => { throw new Error('HTTP ' + r.status) }) })
                .catch(e => setKeyMsg('voice test: ' + String(e && e.message || e).slice(0, 140)))
            },
            children: 'Test voice'
          })
        ] })
      ] })
    }),
    // ---- api keys
    jsx(AoCard, {
      label: 'api keys', delay: 100,
      right: jsx('span', { className: 'font-mono text-[0.6rem] text-(--ui-text-quaternary)', children: 'stored in ~/.hermes/agentos/.env' }),
      children: jsxs('div', { className: 'space-y-2', children: [
        q.isLoading && jsx(Skel, { h: '6rem' }),
        d && Object.entries(d.keys || {}).map(([name, info]) =>
          jsxs('div', { className: 'flex flex-wrap items-center gap-2 rounded-md px-1 py-1.5', children: [
            jsx(Led, { up: info.set ? true : false }),
            jsx(BrandLogo, { name }),
            jsxs('div', { className: 'min-w-0 flex-1 basis-48', children: [
              jsx('div', { className: 'font-mono text-xs text-(--ui-text-primary)', children: name }),
              jsx('div', { className: 'truncate text-[0.68rem] text-(--ui-text-tertiary)', title: info.hint, children: info.hint })
            ] }),
            jsx('input', {
              type: 'password', value: keyDrafts[name] || '',
              onChange: e => setKeyDrafts(m => ({ ...m, [name]: e.target.value })),
              onKeyDown: e => { if (e.key === 'Enter') saveKey(name) },
              placeholder: info.set ? '•••••••• (set)' : 'paste value…',
              autoComplete: 'off', spellCheck: false,
              className: 'w-44 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-tertiary-background) px-2 py-1 font-mono text-xs text-(--ui-text-primary) outline-none placeholder:text-(--ui-text-quaternary) focus:border-(--ui-accent)'
            }),
            jsx('button', {
              type: 'button', className: 'ao-btn',
              disabled: !keyDrafts[name] || keyBusy === name,
              onClick: () => saveKey(name),
              children: keyBusy === name ? '…' : 'Save'
            }),
            info.set && jsx('button', {
              type: 'button', className: 'ao-wbtn', title: 'Remove from .env',
              'aria-label': 'Remove ' + name,
              onClick: () => deleteKey(name), children: '✕'
            })
          ] }, name)
        ),
        // custom key row — any integration this user's stack needs
        jsxs('div', { className: 'flex flex-wrap items-center gap-2 rounded-md border border-dashed border-(--ui-stroke-secondary) px-1 py-1.5', children: [
          jsx('span', { className: 'ao-led', style: { color: 'var(--ui-text-quaternary)', animation: 'none' } }),
          jsx(BrandLogo, { name: customName || '\u2726' }),
          jsx('input', {
            value: customName,
            onChange: e => setCustomName(e.target.value.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase()),
            onKeyDown: e => { if (e.key === 'Enter') addCustomKey() },
            placeholder: 'CUSTOM_KEY_NAME', autoComplete: 'off', spellCheck: false,
            className: 'w-44 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-tertiary-background) px-2 py-1 font-mono text-xs text-(--ui-text-primary) outline-none placeholder:text-(--ui-text-quaternary) focus:border-(--ui-accent)'
          }),
          jsx('input', {
            type: 'password', value: customVal,
            onChange: e => setCustomVal(e.target.value),
            onKeyDown: e => { if (e.key === 'Enter') addCustomKey() },
            placeholder: 'value…', autoComplete: 'off', spellCheck: false,
            className: 'w-44 flex-1 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-tertiary-background) px-2 py-1 font-mono text-xs text-(--ui-text-primary) outline-none placeholder:text-(--ui-text-quaternary) focus:border-(--ui-accent)'
          }),
          jsx('button', {
            type: 'button', className: 'ao-btn',
            disabled: !customName.trim() || !customVal.trim() || keyBusy === '__custom',
            onClick: addCustomKey,
            children: keyBusy === '__custom' ? '…' : 'Add'
          })
        ] }),
        jsx('div', { className: 'text-[0.68rem] text-(--ui-text-quaternary)', children:
          'Values are write-only — the panel shows whether a key is set, never its contents. Login passwords belong in ~/.hermes/agentos/.env, not here.' }),
        keyMsg && jsx('div', { className: 'font-mono text-[0.68rem] text-(--ui-accent)', children: keyMsg })
      ] })
    }),
    // ---- integrations
    jsx(AoCard, {
      label: 'tools & integrations', delay: 160,
      right: jsx('button', {
        type: 'button', className: 'text-xs text-(--ui-accent)',
        onClick: () => cq.refetch(), children: 'Refresh'
      }),
      children: jsxs('div', { className: 'grid gap-4 sm:grid-cols-2', children: [
        jsxs('div', { children: [
          jsx('div', { className: 'ao-label mb-2', children: 'connector accounts' }),
          jsx('div', { className: 'space-y-1', children: hosted.map(c =>
            jsxs('div', { className: 'flex items-center gap-2 rounded-md px-1 py-1 text-sm', children: [
              jsx(Led, { up: c.connected ? true : false }),
              jsx(BrandLogo, { name: c.name }),
              jsx('span', { className: 'min-w-0 flex-1 truncate text-(--ui-text-secondary)', children: c.name }),
              c.connected && c.url && jsx('button', {
                type: 'button', className: 'ao-btn', onClick: () => openExternal(c.url), children: 'Open'
              }),
              !c.connected && jsx('button', {
                type: 'button', className: 'ao-btn', disabled: connBusy === c.name,
                onClick: () => connectConnector(c.name),
                children: connBusy === c.name ? '…' : 'Connect'
              })
            ] }, c.name)
          ) })
        ] }),
        jsxs('div', { children: [
          jsx('div', { className: 'ao-label mb-2', children: 'local mcp servers' }),
          jsx('div', { className: 'space-y-1', children: mcps.map(m =>
            jsxs('div', { className: 'flex items-center gap-2 rounded-md px-1 py-1 text-sm', children: [
              jsx(Led, { up: m.enabled ? true : false }),
              jsx(BrandLogo, { name: m.name }),
              jsx('span', { className: 'min-w-0 flex-1 truncate text-(--ui-text-secondary)', children: m.name }),
              m.url && jsx('button', {
                type: 'button', className: 'ao-btn', onClick: () => openExternal(m.url), children: 'Open'
              })
            ] }, m.name)
          ) }),
          connMsg && jsx('div', { className: 'mt-2 font-mono text-[0.68rem] text-[#f5495b]', children: connMsg })
        ] })
      ] })
    })
  ] })
}

const WIDGETS = {
  hero:    { title: 'Jarvis',        span: 12, rows: 1, render: p => jsx(HeroWidget, p) },
  advisor: { title: 'Advisor',       span: 4,  rows: 5, render: () => jsx(AdvisorCard, {}) },
  todos:   { title: 'Today',         span: 6,  rows: 4, render: () => jsx(TodosCard, {}) },
  brief:   { title: 'Brief',         span: 8,  rows: 4, render: () => jsx(BriefCard, {}) },
  status:  { title: 'Status',        span: 4,  rows: 5, render: () => jsx(StatusCard, {}) },
  calendar:{ title: 'Calendar',     span: 4,  rows: 4, render: () => jsx(CalendarCard, {}) },
  mail:    { title: 'Inbox',        span: 4,  rows: 4, render: () => jsx(MailCard, {}) },
  telegram:{ title: 'Telegram',     span: 4,  rows: 4, render: () => jsx(TelegramCard, {}) },
  voice:   { title: 'Google Voice', span: 4,  rows: 4, render: () => jsx(VoiceCard, {}) },
  automation: { title: 'Automation', span: 4,  rows: 4, render: () => jsx(AutomationCard, {}) },
  memory:  { title: 'Memory',        span: 4,  rows: 4, render: () => jsx(MemoryCard, {}) },
  metrics: { title: 'Metrics',       span: 4,  rows: 4, render: () => jsx(MetricsCard, {}) },
  // tickers + release board retired from the overview grid: tickers live on
  // the Money tab (QuotesCard renders there directly), releases duplicated
  // the projects & apps card. Declutter pass, D's call.
  galaxy:  { title: 'Neural core',   span: 8,  rows: 5, render: p => jsx(NeuralCore, p) },
  console: { title: 'Console',       span: 12, rows: 3, render: () => jsx(AoCard, { label: 'console', delay: 300, children: jsx(ConsoleCard, {}) }) },
  orbit:   { title: 'System orbit',  span: 12, rows: 4, render: () => jsx(OrbitCard, {}) },
  agents:  { title: 'Agent activity', span: 6, rows: 4, render: () => jsx(AgentsCard, {}) }
}

const DEFAULT_ORDER = ['hero', 'galaxy', 'advisor', 'todos', 'brief', 'status', 'calendar', 'mail', 'telegram', 'voice', 'automation', 'memory', 'metrics', 'agents', 'console']

function defaultSizes() {
  const sizes = {}
  for (const [id, w] of Object.entries(WIDGETS)) sizes[id] = { w: w.span, h: w.rows }
  return sizes
}

function loadLayout() {
  try {
    const raw = JSON.parse(localStorage.getItem('agentos-grid-v2') || 'null')
    if (raw && Array.isArray(raw.order)) {
      const order = raw.order.filter(id => WIDGETS[id])
      for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id)
      const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter(id => WIDGETS[id]) : []
      // one-time migration: the connectors/tools orbit card retired in favor of
      // agent activity + release board
      if (!raw.orbitRetired) {
        const oi = order.indexOf('orbit')
        if (oi !== -1) order.splice(oi, 1)
        if (!hidden.includes('orbit')) hidden.push('orbit')
        raw.orbitRetired = true
        try { localStorage.setItem('agentos-grid-v2', JSON.stringify({ ...raw, order, hidden })) } catch { /* ignore */ }
      }
      return {
        order,
        hidden,
        sizes: { ...defaultSizes(), ...(raw.sizes && typeof raw.sizes === 'object' ? raw.sizes : {}) }
      }
    }
  } catch { /* fall through to defaults */ }
  return { order: DEFAULT_ORDER.slice(), hidden: [], sizes: defaultSizes() }
}

function WidgetGrid({ customize, dockPinned, onOpenSpotlight, onOpenServices }) {
  const [layout, setLayout] = useState(loadLayout)
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  // The CSS grid is 4 columns below 900px and 12 above. Card spans wider than
  // the column count create implicit tracks that squeeze cards to slivers —
  // clamp every span to the active column count (mobile cutoff bug, part 2).
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)')
    const on = e => setNarrow(e.matches)
    try { mq.addEventListener('change', on) } catch { mq.addListener(on) }
    return () => { try { mq.removeEventListener('change', on) } catch { mq.removeListener(on) } }
  }, [])
  const dragId = useRef(null)
  const [dragging, setDragging] = useState(null)
  const [overId, setOverId] = useState(null)
  // Grab-handle drag is ALWAYS on: pressing ⠿ arms only that card as draggable
  // for the life of the gesture, so row clicks and text selection keep working.
  const [armed, setArmed] = useState(null)
  const armedRef = useRef(null)
  armedRef.current = armed
  const disarm = () => setArmed(null)
  // release anywhere (not just on the handle) ends the armed gesture
  useEffect(() => {
    window.addEventListener('pointerup', disarm)
    window.addEventListener('pointercancel', disarm)
    return () => { window.removeEventListener('pointerup', disarm); window.removeEventListener('pointercancel', disarm) }
  }, [])

  function persist(next) {
    setLayout(next)
    try { localStorage.setItem('agentos-grid-v2', JSON.stringify(next)) } catch { /* ignore */ }
  }

  // Drag-resize: width follows grid columns, height follows 92px row units.
  // Live preview while dragging; persisted on pointer-up.
  function startResize(e, id) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget.closest('[data-widget]')
    if (!el) return
    el.setAttribute('draggable', 'false')
    const grid = el.parentElement
    const sx = e.clientX
    const sy = e.clientY
    const s0 = layoutRef.current.sizes[id] || { w: WIDGETS[id].span, h: WIDGETS[id].rows }
    const colW = () => grid.clientWidth / 12
    const rowH = 92
    const move = ev => {
      const dw = Math.round((ev.clientX - sx) / colW())
      const dh = Math.round((ev.clientY - sy) / rowH)
      const sizes = {
        ...layoutRef.current.sizes,
        [id]: { w: Math.max(3, Math.min(12, s0.w + dw)), h: Math.max(2, Math.min(12, s0.h + dh)) }
      }
      setLayout({ ...layoutRef.current, sizes })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      el.setAttribute('draggable', 'true')
      persist(layoutRef.current)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function hide(id) {
    haptic('tap')
    persist({ order: layout.order, hidden: Array.from(new Set([...layout.hidden, id])) })
  }

  function reorder(fromId, toId) {
    if (!fromId || fromId === toId) return
    const order = layout.order.filter(x => x !== fromId)
    order.splice(order.indexOf(toId), 0, fromId)
    persist({ ...layout, order })
  }

  const hidden = new Set(layout.hidden)
  if (dockPinned) hidden.add('console') // the pinned dock owns the console when active

  return jsxs('div', { className: 'ao-grid12', children: [
    layout.order.filter(id => !hidden.has(id)).map(id => {
      const w = WIDGETS[id]
      const size = layout.sizes[id] || { w: w.span, h: w.rows }
      const isDragging = dragging === id
      const isOver = overId === id && dragId.current && dragId.current !== id
      return jsxs('div', {
        key: id,
        'data-widget': id,
        className: cn('ao-grid-flip relative'),
        style: { gridColumn: 'span ' + (narrow ? Math.min(size.w, 4) : size.w), gridRow: 'span ' + size.h },
        'data-dragging': isDragging ? '1' : undefined,
        'data-over': isOver ? '1' : undefined,
        draggable: (customize || armed === id) ? 'true' : undefined,
        onDragStart: e => {
          if (!customize && armedRef.current !== id) return
          dragId.current = id
          setDragging(id)
          try { e.dataTransfer.setData('text/plain', id) } catch { /* ignore */ }
          e.dataTransfer.effectAllowed = 'move'
        },
        onDragOver: e => {
          if (!dragId.current) return
          e.preventDefault()
          if (dragId.current !== id) setOverId(id)
        },
        onDragLeave: () => { if (overId === id) setOverId(null) },
        onDrop: e => {
          if (!dragId.current) return
          e.preventDefault()
          reorder(dragId.current, id)
          dragId.current = null
          setDragging(null)
          setOverId(null)
          disarm()
        },
        onDragEnd: () => {
          dragId.current = null
          setDragging(null)
          setOverId(null)
          disarm()
        },
        children: [
          id !== 'hero' && jsxs('div', { className: 'absolute right-2 top-2 z-30 flex items-center gap-1', children: [
            jsx('span', {
              className: 'ao-wbtn', title: 'Drag to reposition \u2014 grab and drop anywhere', 'aria-hidden': 'true',
              style: { cursor: 'grab', fontSize: '.8rem' },
              onPointerDown: () => setArmed(id),
              onPointerUp: disarm,
              children: '⠿'
            }),
            customize && jsx('button', {
              type: 'button', className: 'ao-wbtn', title: 'Hide widget',
              onClick: () => hide(id),
              children: '✕'
            })
          ] }),
          customize && jsx('span', {
            className: 'ao-resize',
            title: 'Drag to resize — width in columns, height in rows',
            onPointerDown: e => startResize(e, id),
            children: '⤡'
          }),
          jsx(WidgetBoundary, { children: w.render({ onOpenSpotlight, onOpenServices }) })
        ]
      }, id) // stable key — ':over' keying remounted the whole card mid-drag
    }),
    layout.hidden.length > 0 && jsx('div', { className: 'ao-w-12 flex flex-wrap items-center gap-2 text-xs text-(--ui-text-tertiary)', children: [
      jsx('span', { children: 'Hidden:' }),
      layout.hidden.map(id => jsx('button', {
        type: 'button',
        className: 'ao-kbd',
        title: 'Show again',
        onClick: () => persist({ order: layout.order, hidden: layout.hidden.filter(x => x !== id) }),
        children: '+ ' + (WIDGETS[id] ? WIDGETS[id].title : id)
      }, id))
    ] })
  ] })
}

// ------------------------------------------------------------ full-viewport modes (Alt+1..4)

const ModeStore = {
  mode: null, // null | 'brief' | 'console' | 'graph' | 'hud'
  _subs: new Set(),
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn) },
  emit() { for (const fn of this._subs) { try { fn() } catch { /* ignore */ } } },
  set(m) { if (this.mode !== m) { this.mode = m; this.emit() } },
  toggle(m) { this.set(this.mode === m ? null : m) }
}
if (typeof window !== 'undefined') {
  window.__deckMode = ModeStore
  if (!window.__deckModeInit) {
    window.__deckModeInit = true
    try {
      const m = new URLSearchParams(window.location.search).get('mode')
      if (m && ['brief', 'console', 'graph', 'hud'].includes(m)) ModeStore.mode = m
    } catch { /* ignore */ }
  }
}

const MODE_TITLES = { brief: 'briefing', console: 'execution console', graph: 'neural graph', hud: 'hud overlay' }

function ModeShell({ title, hint, children }) {
  return jsxs('div', {
    className: 'ao-mode ao-in',
    children: [
      jsxs('div', { className: 'ao-mode-bar', children: [
        jsx('span', { className: 'ao-wordmark text-sm font-semibold text-(--ui-accent) ao-hero-glow', children: '// ' + title.toUpperCase() }),
        hint && jsx('span', { className: 'font-mono text-[0.6rem] text-(--ui-text-quaternary)', children: hint }),
        jsx('span', { className: 'ml-auto font-mono text-[0.6rem] text-(--ui-text-quaternary)', children: 'esc to exit' }),
        jsx('button', { type: 'button', className: 'ao-wbtn', title: 'Exit mode', onClick: () => ModeStore.set(null), children: '✕' })
      ] }),
      jsx('div', { className: 'flex min-h-0 flex-1 flex-col', children })
    ]
  })
}

function BriefingMode() {
  const q = useQuery({
    queryKey: ['agentos', 'brief_today'],
    queryFn: () => REST('/brief/today'),
    refetchInterval: 300000
  })
  const [busy, setBusy] = useState(false)
  const d = q.data
  const text = (d && (d.text || d.brief || '')) || ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saveState, setSaveState] = useState(null) // null | 'saving' | 'saved' | error string
  function startEdit() { setDraft(text); setSaveState(null); setEditing(true) }
  async function saveEdit() {
    setSaveState('saving')
    try {
      await REST('/brief/save', { method: 'POST', body: { brief: draft }, timeoutMs: 30000 })
      setSaveState('saved')
      setEditing(false)
      await q.refetch()
    } catch (e) { setSaveState(String((e && e.message) || e).slice(0, 200)) }
  }
  async function generate() {
    setBusy(true)
    try { await REST('/brief/generate', { method: 'POST' }); await q.refetch() } catch (e) { /* ignore */ }
    setBusy(false)
  }
  return jsx(ModeShell, {
    title: 'briefing',
    hint: 'daily brief · full screen',
    children: jsxs('div', { className: 'mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto p-6', children: [
      jsxs('div', { className: 'flex items-center gap-2', children: [
        jsx('button', { type: 'button', className: 'ao-btn', onClick: generate, disabled: busy, children: busy ? 'generating…' : 'GENERATE' }),
        text && jsx('button', { type: 'button', className: 'ao-btn', onClick: () => Tts.speak(text), children: 'SPEAK' }),
        text && !editing && jsx('button', { type: 'button', className: 'ao-btn', onClick: startEdit, children: 'EDIT' }),
        text && jsx('button', { type: 'button', className: 'ao-btn border-[#f5495b]/50 text-[#f5495b]', onClick: stopJarvisSpeech, children: 'STOP' }),
        jsx('span', { className: 'ml-auto font-mono text-[0.6rem] text-(--ui-text-quaternary)', children: d && d.date ? d.date : '' })
      ] }),
      q.isLoading && jsx(Skel, { h: '12rem' }),
      editing ? jsxs(Fragment, { children: [
        jsx('textarea', {
          value: draft,
          onChange: e => setDraft(e.target.value),
          rows: 20,
          spellCheck: false,
          className: 'w-full flex-1 rounded-lg border border-(--ui-accent)/40 bg-[rgba(6,10,16,.6)] p-4 font-mono text-[0.85rem] leading-relaxed text-(--ui-text-primary) outline-none focus:border-(--ui-accent)',
          placeholder: 'Edit the brief markdown — add, change or delete items, then save'
        }),
        jsxs('div', { className: 'flex items-center gap-2', children: [
          jsx('button', { type: 'button', className: 'ao-btn', onClick: saveEdit, disabled: saveState === 'saving' || !draft.trim(), children: saveState === 'saving' ? 'saving…' : 'SAVE' }),
          jsx('button', { type: 'button', className: 'ao-btn', onClick: () => { setEditing(false); setSaveState(null) }, children: 'CANCEL' }),
          typeof saveState === 'string' && jsx('span', { className: 'text-xs text-[#f85149]', children: saveState }),
          saveState === 'saved' && jsx('span', { className: 'text-xs text-[#3fb950]', children: 'saved' })
        ] })
      ] }) : text ? jsx('div', {
        className: 'whitespace-pre-wrap font-mono text-[0.92rem] leading-relaxed text-(--ui-text-secondary)',
        children: text
      }) : !q.isLoading && jsx('div', { className: 'text-sm text-(--ui-text-quaternary)', children: 'No brief for today yet. Hit GENERATE.' })
    ] })
  })
}

function ConsoleMode() {
  const [, force] = useState(0)
  useEffect(() => ConsoleStore.subscribe(() => force(v => v + 1)), [])
  const [text, setText] = useState('')
  const msgs = ConsoleStore.msgs
  const endRef = useRef(null)
  useEffect(() => { if (endRef.current) endRef.current.scrollIntoView({ block: 'end' }) }, [msgs.length, ConsoleStore.busy])
  const svcQ = useQuery({ queryKey: ['agentos', 'status'], queryFn: () => REST('/status'), refetchInterval: 120000 })
  const svcs = (svcQ.data && svcQ.data.services) || []
  const todoQ = useQuery({ queryKey: ['agentos', 'todos'], queryFn: () => REST('/todos'), refetchInterval: 120000 })
  function send() {
    const t = text.trim()
    if (!t || ConsoleStore.busy) return
    setText('')
    ConsoleStore.send(t)
  }
  return jsx(ModeShell, {
    title: 'execution console',
    hint: 'live command stream · split panes',
    children: jsxs('div', { className: 'flex min-h-0 flex-1 gap-3 p-4', children: [
      jsxs('div', { className: 'flex min-w-0 flex-1 flex-col rounded-xl border border-(--ui-stroke-secondary) bg-[rgba(6,10,16,.6)]', children: [
        jsx('div', { className: 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4 font-mono text-xs', children:
          msgs.length ? msgs.map((m, i) => jsxs('div', { className: 'whitespace-pre-wrap break-words', children: [
            jsx('span', { className: m.role === 'you' ? 'text-(--ui-accent)' : 'text-[#7ee787]', children: (m.role === 'you' ? '▸ you  ' : '◆ jarvis  ') }),
            jsx('span', { className: 'text-(--ui-text-secondary)', children: m.text })
          ] }, i)) : jsx('div', { className: 'text-(--ui-text-quaternary)', children: 'No commands yet — type below or press Ctrl+J.' })
        }),
        ConsoleStore.busy && jsx('div', { className: 'px-4 pb-1 font-mono text-[0.65rem] text-(--ui-accent)', children: '… working on: ' + (ConsoleStore.current || '') }),
        jsxs('div', { className: 'flex items-center gap-2 border-t border-(--ui-stroke-secondary) p-3', children: [
          jsx('input', {
            value: text,
            onChange: e => setText(e.target.value),
            onKeyDown: e => { if (e.key === 'Enter') { e.preventDefault(); send() } },
            placeholder: 'command or question — Enter to run',
            className: 'min-w-0 flex-1 rounded-md border border-(--ui-border) bg-transparent px-3 py-2 font-mono text-xs text-(--ui-text-primary) outline-none placeholder:text-(--ui-text-quaternary) focus:border-(--ui-accent)',
            spellCheck: false
          }),
          jsx('button', { type: 'button', className: 'ao-btn', onClick: send, disabled: ConsoleStore.busy, children: ConsoleStore.busy ? '…' : 'RUN' })
        ] })
      ] }),
      jsxs('div', { className: 'flex w-64 shrink-0 flex-col gap-3 overflow-y-auto rounded-xl border border-(--ui-stroke-secondary) bg-[rgba(6,10,16,.6)] p-4', children: [
        jsx('div', { className: 'ao-label', children: 'services' }),
        jsx('div', { className: 'space-y-1.5', children: svcs.slice(0, 12).map(s =>
          jsxs('div', { className: 'flex items-center gap-2 text-xs', children: [
            jsx('span', { className: 'inline-block h-1.5 w-1.5 shrink-0 rounded-full', style: { background: s.up === false ? '#f5495b' : s.up === true ? '#3fb950' : '#d29922' } }),
            jsx('span', { className: 'truncate text-(--ui-text-secondary)', children: s.name }),
            s.ms != null && jsx('span', { className: 'ml-auto font-mono text-[10px] text-(--ui-text-quaternary)', children: s.ms + 'ms' })
          ] }, s.name)
        ) }),
        jsx('div', { className: 'ao-label mt-2', children: 'tasks' }),
        jsx('div', { className: 'text-xs text-(--ui-text-secondary)', children: ((todoQ.data && todoQ.data.total_open) || 0) + ' open on the board' }),
        jsx('button', {
          type: 'button', className: 'ao-btn mt-2',
          onClick: () => { ModeStore.set(null); JarvisCtl.send('Generate my daily brief') },
          children: 'RUN DAILY BRIEF'
        })
      ] })
    ] })
  })
}

function GraphMode() {
  return jsx(ModeShell, {
    title: 'neural graph',
    hint: 'full-screen memory galaxy',
    children: jsx('div', { className: 'min-h-0 flex-1 p-3', children:
      jsx('div', { style: { position: 'relative', width: '100%', height: '100%' }, children: jsx(NeuralCore, {}) })
    })
  })
}

function HudOverlay() {
  const [hudOp] = useSharedNum('agentos-hud-opacity', 1)
  const [state, setState] = useState(OrbBus.state)
  useEffect(() => OrbBus.subscribe(setState), [])
  const [, force] = useState(0)
  useEffect(() => ConsoleStore.subscribe(() => force(v => v + 1)), [])
  const now = useNow()
  const statusQ = useQuery({ queryKey: ['agentos', 'status'], queryFn: () => REST('/status'), refetchInterval: 120000 })
  const todoQ = useQuery({ queryKey: ['agentos', 'todos'], queryFn: () => REST('/todos'), refetchInterval: 120000 })
  const svcs = (statusQ.data && statusQ.data.services) || []
  const up = svcs.filter(s => s.up === true).length
  const downSvcs = svcs.filter(s => s.up === false)
  const open = (todoQ.data && todoQ.data.total_open) || 0
  const tasks = (todoQ.data && todoQ.data.tasks) || []
  const word = { idle: 'Standing by', listening: 'Listening…', thinking: 'Processing…', speaking: 'Speaking', working: 'Working…' }[state]
  const busy = ConsoleStore.busy
  const companion = typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('companion') === '1'
  const rootRef = useRef(null)
  // Auto-fit the companion window to the panel so there is no dead space below.
  useEffect(() => {
    if (!companion || !window.hudCompanion || !rootRef.current) return undefined
    const el = rootRef.current
    const report = () => window.hudCompanion.resize(Math.ceil(el.getBoundingClientRect().height) + 20)
    const ro = new ResizeObserver(report)
    ro.observe(el)
    report()
    return () => ro.disconnect()
  }, [companion])
  // Manual window drag for the Electron companion (app-region is unreliable in
  // transparent frameless windows on Windows): press anywhere that isn't a
  // button/input and the window follows the cursor until release.
  useEffect(() => {
    if (!companion || !window.hudCompanion) return undefined
    const onDown = e => {
      if (e.target && e.target.closest && e.target.closest('button,input,a,summary')) return
      window.hudCompanion.startDrag()
    }
    const onUp = () => window.hudCompanion.stopDrag()
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointerup', onUp, true)
    return () => {
      window.hudCompanion.stopDrag()
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointerup', onUp, true)
    }
  }, [companion])
  return jsxs('div', {
    ref: rootRef,
    className: 'ao-hud ao-in' + (companion ? ' ao-hud-fill ao-hud-drag' : ''),
    style: { opacity: hudOp },
    children: [
      jsxs('div', { className: 'flex items-center gap-3', children: [
        jsx(MiniOrb, { size: 46 }),
        jsxs('div', { className: 'min-w-0 flex-1', children: [
          jsxs('div', { className: 'flex items-center gap-3', children: [
            jsx('span', { className: 'text-sm font-semibold ao-hero-glow', style: { color: ORB_STATE_COLORS[state] }, children: word }),
            busy && jsx('span', { className: 'truncate font-mono text-[0.6rem] text-(--ui-text-tertiary)', children: '· ' + (ConsoleStore.current || '') }),
            jsx('span', { className: 'ml-auto font-mono text-[0.6rem] text-(--ui-text-quaternary)', children: now.toLocaleTimeString('en-US', { hour12: false }) }),
            jsx('button', {
              type: 'button', className: 'ao-wbtn',
              title: companion ? 'Hide HUD (Alt+Space brings it back)' : 'Exit HUD',
              onClick: () => {
                if (companion && window.hudCompanion && window.hudCompanion.hide) window.hudCompanion.hide()
                else ModeStore.set(null)
              },
              children: '✕'
            })
          ] }),
          jsxs('div', { className: 'mt-1 flex items-center gap-2 font-mono text-[0.65rem]', children: [
            jsx('span', { children: 'SVC ' }),
            jsx('span', { style: { color: downSvcs.length > 0 ? '#f5495b' : '#3fb950' }, children: up + '/' + svcs.length }),
            jsx('span', { className: 'ml-2', children: open + ' open' }),
            (downSvcs.length > 0) && jsx('span', { className: 'text-[#f5495b]', children: '· ' + downSvcs.length + ' down' })
          ] })
        ] })
      ] }),
      downSvcs.length > 0 && jsx('div', { className: 'mt-2 truncate font-mono text-[0.62rem] text-[#f5495b]', title: downSvcs.map(s => s.name).join(', '), children:
        '▼ ' + downSvcs.map(s => s.name).join(' · ') }),
      tasks.length > 0 && jsx('div', { className: 'mt-1.5 space-y-0.5', children: tasks.slice(0, 3).map((t, i) =>
        jsx('div', { className: 'truncate font-mono text-[0.62rem] text-(--ui-text-tertiary)', title: t.title, children:
          '▸ ' + t.title }, 'hudtask' + i)) }),
      jsxs('div', { className: 'mt-2.5 flex items-center gap-1.5', children: [
        jsx('button', { type: 'button', className: 'ao-runbtn', onClick: () => { JarvisCtl.send('Generate my daily brief') }, children: ['◆', 'brief'] }),
        jsx('button', { type: 'button', className: 'ao-runbtn', onClick: () => { JarvisCtl.openSpotlight && JarvisCtl.openSpotlight() }, children: ['⌘', 'ask'] }),
        state === 'speaking' && jsx('button', { type: 'button', className: 'ao-runbtn border-[#f5495b]/50 text-[#f5495b]', onClick: stopJarvisSpeech, children: ['⏹', 'stop'] })
      ] })
    ]
  })
}

// Compact state orb for the HUD companion: gradient core tinted by assistant
// state + the same 2D instrument rings OrbHud draws, at miniature scale.
const MINI_ORB_CORE = {
  idle: 'rgba(92, 214, 255, 0.85)',
  listening: 'rgba(248, 81, 73, 0.9)',
  thinking: 'rgba(168, 85, 247, 0.9)',
  speaking: 'rgba(168, 85, 247, 0.9)',
  working: 'rgba(168, 85, 247, 0.95)'
}
function MiniOrb({ size = 46 }) {
  const [st, setSt] = useState(OrbBus.state)
  useEffect(() => OrbBus.subscribe(setSt), [])
  const core = MINI_ORB_CORE[st] || MINI_ORB_CORE.idle
  const active = st !== 'idle'
  return jsxs('div', {
    role: 'status', 'aria-label': 'Jarvis mini orb', title: 'Jarvis state: ' + st,
    style: { position: 'relative', width: size, height: size, flex: 'none' },
    children: [
      jsx('div', {
        'aria-hidden': 'true',
        style: {
          position: 'absolute', inset: '14%', borderRadius: '50%',
          background: 'radial-gradient(circle at 36% 30%, rgba(255,255,255,0.55), ' + core + ' 42%, transparent 74%)',
          filter: 'blur(3px)',
          animation: 'aoBreathe ' + (active ? '1.2s' : '3.4s') + ' ease-in-out infinite',
          opacity: active ? 1 : 0.65
        }
      }),
      jsx(OrbHud, {})
    ]
  })
}

function ModeOverlay({ mode }) {
  if (mode === 'brief') return jsx(BriefingMode, {})
  if (mode === 'console') return jsx(ConsoleMode, {})
  if (mode === 'graph') return jsx(GraphMode, {})
  if (mode === 'hud') return jsx(HudOverlay, {})
  return null
}

// ------------------------------------------------------------ page

function AgentosPage() {
  // HUD companion shell (Electron) renders ONLY the HUD — set ?companion=1&mode=hud
  const companion = typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('companion') === '1'
  const [tab, setTab] = useState('overview')
  const [accent, setAccent] = useLocal('agentos-accent', null)
  const [customize, setCustomize] = useState(false)
  const [dockPinned, setDockPinned] = useLocal('agentos-dock', false)
  const [spotOpen, setSpotOpen] = useState(false)
  const [svcOpen, setSvcOpen] = useState(false)
  const [mode, setMode] = useState(ModeStore.mode)
  useEffect(() => ModeStore.subscribe(() => setMode(ModeStore.mode)), [])
  // Kill Chrome middle-click autoscroll: an accidental scroll-wheel PRESS starts
  // it, and the page then drifts toward the cursor's offset from the origin
  // (reads as "page scrolls by itself when I'm not touching the mouse").
  useEffect(() => {
    const stop = e => { if (e.button === 1) e.preventDefault() }
    window.addEventListener('mousedown', stop, { capture: true })
    return () => window.removeEventListener('mousedown', stop, { capture: true })
  }, [])
  // Card rows (services, galaxy nodes) request the services drawer via DrawerBus.
  useEffect(() => DrawerBus.subscribe(() => setSvcOpen(true)), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [, force] = useState(0)
  useEffect(() => ConsoleStore.subscribe(() => force(v => v + 1)), [])
  const svcQ = useQuery({
    queryKey: ['agentos', 'status'],
    queryFn: () => REST('/status'),
    refetchInterval: 120000
  })
  const svcs = (svcQ.data && svcQ.data.services) || []
  const tabs = [
    ['overview', 'Overview'],
    ['vision', 'Vision'],
    ['money', 'Money'],
    ['goals', 'Goals'],
    ['settings', 'Settings']
  ]
  const tabIndex = tabs.findIndex(t => t[0] === tab)

  // Accent theme override + semantic color tokens
  useEffect(() => {
    const root = document.documentElement
    if (accent && AO_THEMES[accent]) root.style.setProperty('--ui-accent', AO_THEMES[accent])
    root.style.setProperty('--st-nominal', '#5cd6ff')
    root.style.setProperty('--st-degraded', '#ffb84d')
    root.style.setProperty('--st-alert', '#f5495b')
    root.style.setProperty('--st-active', '#a855f7')
    return () => { root.style.removeProperty('--ui-accent') }
  }, [accent])

  // Ctrl/Cmd+J spotlight (Ctrl+K belongs to the Hermes command palette) — works anywhere on this page.
  useEffect(() => {
    JarvisCtl.openSpotlight = () => setSpotOpen(true)
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        setSpotOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Alt+1..4 full-viewport modes; Esc exits the active mode.
  useEffect(() => {
    const map = { 1: 'brief', 2: 'console', 3: 'graph', 4: 'hud' }
    const onKey = e => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && map[e.key]) {
        e.preventDefault()
        haptic('tap')
        ModeStore.toggle(map[e.key])
      } else if (e.key === 'Escape' && ModeStore.mode) {
        ModeStore.set(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Spacebar push-to-talk: space outside any input starts the voice console.
  useEffect(() => {
    const onKey = e => {
      if (e.code !== 'Space' || e.repeat) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (JarvisCtl.canVoice) { e.preventDefault(); JarvisCtl.toggleVoice() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Chime when the mic engages from anywhere (reply chime lives in the console store).
  useEffect(() => OrbBus.subscribe(st => { if (st === 'listening') Chimes.play('up') }), [])

  // HUD companion: render nothing but the floating panel.
  if (companion) {
    // Transparent window: the page must not paint any background (the aurora
    // layer painted the opaque dark rectangle D saw around the HUD).
    try { document.documentElement.classList.add('ao-companion') } catch { /* ignore */ }
    return jsxs(Fragment, { children: [jsx(StyleOnce, {}), jsx(HudOverlay, {})] })
  }

  return jsxs('div', {
    className: 'ao-scrollpage relative flex h-full flex-col gap-3 overflow-auto p-4 text-sm',
    children: [
      jsx(StyleOnce, {}),
      jsx('div', { className: 'ao-aurora' }),
      // header
      jsxs('div', { className: 'relative z-10 flex flex-wrap items-center justify-between gap-2', children: [
        jsxs('div', { className: 'flex items-baseline gap-3', children: [
          jsxs('div', { children: [
            jsx('div', {
              className: 'ao-wordmark text-base font-semibold text-(--ui-accent) ao-hero-glow',
              children: 'JARVIS DECK // OPS CONTROL'
            }),
            jsx('div', {
              className: 'mt-0.5 font-mono text-[0.6rem] uppercase tracking-[0.22em] text-(--ui-text-quaternary)',
              children: 'neural interface · personal ops deck'
            })
          ] }),
          jsx('button', {
            type: 'button',
            className: 'ao-kbd',
            onClick: () => setSpotOpen(true),
            title: 'Open the command runner',
            children: 'Ctrl J'
          })
        ] }),
        jsxs('div', { className: 'flex flex-wrap items-center gap-4', children: [
          jsxs('div', { className: 'flex items-center gap-1.5', title: 'accent theme', children: [
            Object.entries(AO_THEMES).map(([name, col]) =>
              jsx('span', {
                className: 'ao-dot',
                'data-active': accent === name ? '1' : '0',
                style: { background: col, color: col },
                onClick: () => setAccent(accent === name ? null : name)
              }, name)
            ),
            jsx('button', {
              type: 'button',
              className: 'ao-wbtn ml-1',
              title: 'chimes on/off (voice + HUD sounds)',
              onClick: () => {
                const off = localStorage.getItem('agentos-chimes') === 'off'
                try { localStorage.setItem('agentos-chimes', off ? 'on' : 'off') } catch { /* ignore */ }
                if (off) Chimes.play('up')
                force(v => v + 1)
              },
              children: (() => { try { return localStorage.getItem('agentos-chimes') === 'off' ? '✕' : '♪' } catch { return '♪' } })()
            })
          ] }),
          jsx('button', {
            type: 'button',
            className: cn('ao-kbd', dockPinned && 'border-(--ui-accent) text-(--ui-accent)'),
            onClick: () => setDockPinned(!dockPinned),
            title: 'Pin the command dock as a persistent sidebar',
            children: dockPinned ? 'Dock pinned' : 'Pin dock'
          }),
          jsx('button', {
            type: 'button',
            className: cn('ao-kbd', customize && 'border-(--ui-accent) text-(--ui-accent)'),
            onClick: () => { haptic('tap'); setCustomize(c => !c) },
            title: 'Customize the grid — drag widgets to reorder, ✕ to hide',
            children: customize ? 'Done' : 'Customize'
          })
        ] })
      ] }),
      // tabs
      jsxs('div', { className: 'relative z-10 grid grid-cols-5 border-b border-(--ui-stroke-secondary)', children: [
        tabs.map(([id, label]) =>
          jsx('button', {
            type: 'button',
            className: cn('py-1.5 text-sm transition-colors',
              tab === id ? 'text-(--ui-text-primary)' : 'text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)'),
            onClick: () => { haptic('tap'); setTab(id) },
            children: label
          }, id)
        ),
        jsx('div', { className: 'ao-tabline', style: { transform: 'translateX(' + tabIndex * 100 + '%)' } })
      ] }),
      // content
      jsx('div', { key: tab, className: 'relative z-10 ao-in flex flex-col gap-3', children: [
        tab === 'overview' && jsxs('div', { className: 'flex gap-3', children: [
          jsxs('div', { className: 'min-w-0 flex-1', children: [
            jsx(WidgetGrid, { customize, dockPinned, onOpenSpotlight: () => setSpotOpen(true), onOpenServices: () => setSvcOpen(true) })
          ] }),
          dockPinned && jsx('div', { className: 'ao-dock shrink-0', children:
            jsx(WidgetBoundary, { children:
              jsx(AoCard, { label: 'command dock', delay: 60,
                right: jsx('button', {
                  type: 'button', className: 'text-xs text-(--ui-accent)',
                  onClick: () => setDockPinned(false),
                  title: 'Unpin the dock',
                  children: 'Unpin'
                }),
                children: jsx(ConsoleCard, { compact: true })
              })
            })
          })
        ] }),
        tab === 'vision' && jsx('div', { className: 'mx-auto w-full max-w-4xl', children:
          jsx(WidgetBoundary, { children: jsx(VisionCard, {}) })
        }),
        tab === 'money' && jsx(MoneySection, {}),
        tab === 'goals' && jsxs('div', { className: 'mx-auto w-full max-w-4xl flex flex-col gap-3', children: [
          jsx(WidgetBoundary, { children: jsx(GoalsCard, {}) }),
          jsx(WidgetBoundary, { children: jsx(ExportCard, {}) })
        ] }),
        tab === 'settings' && jsx(WidgetBoundary, { children: jsx(SettingsSection, {}) })
      ] }),
      jsx(Spotlight, { open: spotOpen, onClose: () => setSpotOpen(false) }),
      jsx(ServiceDrawer, { svcs, open: svcOpen, onClose: () => setSvcOpen(false) }),
      mode && jsx(ModeOverlay, { mode })
    ]
  })
}

export default {
  id: 'agentos',
  name: 'OS Dashboard',
  register(ctx) {
    REST = (path, opts) => ctx.rest(path, opts)
    openExternal = (ctx.os && typeof ctx.os.openExternal === 'function')
      ? url => ctx.os.openExternal(url)
      : url => { try { window.open(url, '_blank', 'noopener') } catch { /* blocked */ } }
    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/agentos' },
        render: () => jsx(AgentosPage, {})
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: { path: '/agentos', label: 'OS Dashboard', codicon: 'dashboard' }
      }
    ])
  }
}
