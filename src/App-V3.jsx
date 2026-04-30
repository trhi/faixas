import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Info, Volume2, VolumeX, Play, Pause, RotateCcw } from 'lucide-react';
import { jsPDF } from 'jspdf';

const MIN_GRID_SIZE = 15;
const DATASET_ROOT = `${import.meta.env.BASE_URL}audio-library/current/`;
const USER_TRAVERSAL_STORAGE_KEY = 'faixas-user.json';
const USER_TRAVERSAL_PDF_FILE_NAME = 'faixas-zine.pdf';
const ENABLE_TRAVERSAL_CACHE = true;
const ZINE_PDF_STYLES = {
  ZINE_V1: 'zine-v1',
  ZINE_V2: 'zine-v2',
  ZINE_V2_LORA: 'zine-v2-lora',
  RANDOM: 'random',
};
const AVAILABLE_ZINE_PDF_STYLES = [
  ZINE_PDF_STYLES.ZINE_V1,
  ZINE_PDF_STYLES.ZINE_V2,
  ZINE_PDF_STYLES.ZINE_V2_LORA,
];
const ACTIVE_ZINE_PDF_STYLE = ZINE_PDF_STYLES.ZINE_V2_LORA;
const ENABLE_ZINE_GRID_DEBUG_LABELS = false;
const ZINE_LORA_FONT_URL = `${import.meta.env.BASE_URL}fonts/Lora-wght.ttf`;
const ZINE_LORA_FONT_VFS_NAME = 'Lora-wght.ttf';
const ZINE_LORA_ITALIC_FONT_URL = `${import.meta.env.BASE_URL}fonts/Lora-Italic-wght.ttf`;
const ZINE_LORA_ITALIC_FONT_VFS_NAME = 'Lora-Italic-wght.ttf';
const ZINE_LORA_FONT_FAMILY = 'Lora';
const CURRENT_DD_MM_YYYY = (() => {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  return `${dd}·${mm}·${yyyy}`;
})();
const ZINE_FRONT_COVER_LINES = ['Faixas de', 'Rodagem do', 'Pensamento'];
const ZINE_BACK_COVER_LINES = ['2026 —', 'Terhi Marttila', `— e Tu, ${CURRENT_DD_MM_YYYY}`];
const ZINE_PASTE_BACK_COVER_TEXT = ['[colar no verso', 'da contracapa]'];
const ZINE_PASTE_FRONT_COVER_TEXT = ['[colar no verso', '— — — da capa]'];
const APP_PALETTE_OLD = {
  bgMain: '#060a08',
  bgPanel: '#08100d',
  bgPanelSoft: 'rgba(8, 16, 13, 0.95)',
  bgSurface: '#0a1410',
  bgAccent: '#112115',
  border: '#1b3022',
  borderHover: 'rgba(26, 48, 34, 0.6)',
  greenMuted: '#4a9460',
  greenMutedSoft: 'rgba(74, 148, 96, 0.2)',
  greenBright: '#4CAF50',
  greenGlowSoft: 'rgba(74, 148, 96, 0.3)',
  greenGlowStrong: 'rgba(76, 175, 80, 0.4)',
  maroon: '#8c1c40',
  pink: '#f23a99',
};
const APP_PALETTE = {
  bgMain: '#060a08',
  bgPanel: '#08100d',
  bgPanelSoft: 'rgba(8, 16, 13, 0.95)',
  bgSurface: '#0a1410',
  bgAccent: '#112115',
  border: '#1b3022',
  borderSoft: 'rgba(27, 48, 34, 0.4)',
  borderFaint: 'rgba(27, 48, 34, 0.3)',
  borderHover: 'rgba(26, 48, 34, 0.6)',
  greenMuted: '#48FFC2',
  greenMutedSoft: 'rgba(74, 148, 96, 0.2)',
  greenBright: '#48FFC2',
  greenGlowSoft: '#48FFC2',
  greenGlowStrong: '#48FFC2',
  maroon: '#9C0072',
  pink: '#FF0CBA',
  euBg: '#080006',
  euColor: '#FF0CBA',
};

const pdfFontBinaryCache = new Map();

/**
 * Smoothly scrolls a container to (targetLeft, targetTop) with a cubic ease-in-out curve.
 * Returns a cancel function that stops the animation mid-flight.
 */
function smoothScrollTo(container, targetLeft, targetTop, duration = 600) {
  const startLeft = container.scrollLeft;
  const startTop = container.scrollTop;
  const deltaLeft = targetLeft - startLeft;
  const deltaTop = targetTop - startTop;
  const startTime = performance.now();
  let rafId;

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    const e = easeInOutCubic(t);
    container.scrollLeft = startLeft + deltaLeft * e;
    container.scrollTop = startTop + deltaTop * e;
    if (t < 1) rafId = requestAnimationFrame(step);
  }

  rafId = requestAnimationFrame(step);
  return () => cancelAnimationFrame(rafId);
}

function arrayBufferToBinaryString(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return binary;
}

async function getPdfFontBinary(url) {
  if (pdfFontBinaryCache.has(url)) {
    return pdfFontBinaryCache.get(url);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load PDF font from ${url} (${response.status})`);
  }

  const binary = arrayBufferToBinaryString(await response.arrayBuffer());
  pdfFontBinaryCache.set(url, binary);
  return binary;
}

async function registerPdfFont(pdf, { url, vfsFileName, fontFamily, fontStyle = 'normal' }) {
  const binary = await getPdfFontBinary(url);
  pdf.addFileToVFS(vfsFileName, binary);
  pdf.addFont(vfsFileName, fontFamily, fontStyle);
}

function getDatasetBaseUrl() {
  return new URL(DATASET_ROOT, window.location.href);
}

function buildSentenceData(manifestEntries) {
  const datasetBaseUrl = getDatasetBaseUrl();
  const sortedEntries = [...manifestEntries].sort((a, b) => {
    if (a.recording_id !== b.recording_id) return a.recording_id.localeCompare(b.recording_id);
    if (a.sentence_id !== b.sentence_id) return a.sentence_id - b.sentence_id;
    return a.fragment_id - b.fragment_id;
  });

  const groupedSentences = new Map();
  const variantsByText = new Map();

  for (const entry of sortedEntries) {
    const sentenceKey = `${entry.recording_id}::${entry.sentence_id}`;
    const fragmentWithAudio = {
      ...entry,
      audioUrl: new URL(entry.file, datasetBaseUrl).toString(),
    };

    if (!groupedSentences.has(sentenceKey)) {
      groupedSentences.set(sentenceKey, []);
    }
    groupedSentences.get(sentenceKey).push(fragmentWithAudio);

    if (!variantsByText.has(entry.normalized_text)) {
      variantsByText.set(entry.normalized_text, []);
    }
    variantsByText.get(entry.normalized_text).push(fragmentWithAudio);
  }

  return {
    sequences: Array.from(groupedSentences.values()),
    variantsByText,
  };
}

function createNodeId(normalizedText) {
  return `node_${normalizedText.replace(/\s+/g, '_').replace(/[^a-z0-9_à-ÿ]/gi, '')}`;
}

function createEmptyGraph() {
  const center = Math.floor(MIN_GRID_SIZE / 2);
  const grid = Array.from({ length: MIN_GRID_SIZE }, () => Array(MIN_GRID_SIZE).fill(null));
  grid[center][center] = 'root';

  return {
    nodes: {
      root: {
        id: 'root',
        text: 'eu',
        normalizedText: 'eu',
        x: center,
        y: center,
        next: [],
        audioVariants: [],
      },
    },
    grid,
    rootId: 'root',
    center,
    gridSize: MIN_GRID_SIZE,
  };
}

function createSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isEuFragment(fragmentText) {
  return /^eu\b/i.test(fragmentText.trim());
}

function buildPdfTextFromFragments(fragments) {
  const lines = [];

  for (const rawFragment of fragments) {
    const fragment = String(rawFragment ?? '').trim();
    if (!fragment) continue;

    if (isEuFragment(fragment) && lines.length > 0) {
      lines.push('');
    }

    lines.push(fragment);
  }

  return lines.join('\n');
}

function createEmptyTraversalRecord() {
  const now = new Date().toISOString();
  return {
    fileName: USER_TRAVERSAL_STORAGE_KEY,
    schemaVersion: 1,
    sessionId: createSessionId(),
    createdAt: now,
    updatedAt: now,
    fragments: [],
    pdfText: '',
  };
}

function normalizeTraversalRecord(candidate) {
  const fallback = createEmptyTraversalRecord();

  if (!candidate || typeof candidate !== 'object') {
    return fallback;
  }

  const fragments = Array.isArray(candidate.fragments)
    ? candidate.fragments.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];

  const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : fallback.createdAt;
  const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : createdAt;

  return {
    fileName:
      typeof candidate.fileName === 'string' && candidate.fileName.trim()
        ? candidate.fileName
        : USER_TRAVERSAL_STORAGE_KEY,
    schemaVersion: 1,
    sessionId:
      typeof candidate.sessionId === 'string' && candidate.sessionId.trim()
        ? candidate.sessionId
        : fallback.sessionId,
    createdAt,
    updatedAt,
    fragments,
    pdfText: buildPdfTextFromFragments(fragments),
  };
}

function loadTraversalRecordFromSession() {
  if (!ENABLE_TRAVERSAL_CACHE || typeof window === 'undefined') return createEmptyTraversalRecord();

  try {
    const serialized = window.sessionStorage.getItem(USER_TRAVERSAL_STORAGE_KEY);
    if (!serialized) {
      return createEmptyTraversalRecord();
    }

    return normalizeTraversalRecord(JSON.parse(serialized));
  } catch {
    return createEmptyTraversalRecord();
  }
}

function persistTraversalRecord(record) {
  if (!ENABLE_TRAVERSAL_CACHE || typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(USER_TRAVERSAL_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Ignore quota/privacy errors and keep in-memory tracking working.
  }
}

// Stable fallback generator: keep this strategy available while testing new zine styles.
function generateZinePdfV1(sourceText, fileName) {
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginX = 40;
  const marginTop = 56;
  const marginBottom = 56;
  const columnCount = 5;
  const columnGap = 24;
  const columnWidth = (pageWidth - marginX * 2 - columnGap * (columnCount - 1)) / columnCount;
  const maxY = pageHeight - marginBottom;
  const baseLineHeight = 18;

  pdf.setFont('times', 'normal');
  pdf.setFontSize(13);

  let currentColumn = 0;
  let cursorY = marginTop;
  const lines = sourceText.split('\n');

  const getColumnX = () => marginX + currentColumn * (columnWidth + columnGap);

  const advanceColumn = () => {
    currentColumn += 1;

    if (currentColumn >= columnCount) {
      pdf.addPage();
      currentColumn = 0;
    }

    cursorY = marginTop;
  };

  const ensureSpace = (requiredLines = 1) => {
    const requiredHeight = baseLineHeight * Math.max(requiredLines - 1, 0);
    if (cursorY + requiredHeight > maxY) {
      advanceColumn();
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      ensureSpace(1);
      cursorY += baseLineHeight;
    } else {
      const wrapped = pdf.splitTextToSize(line, columnWidth);

      ensureSpace(wrapped.length);

      for (const wrappedLine of wrapped) {
        pdf.text(wrappedLine, getColumnX(), cursorY);
        cursorY += baseLineHeight;
      }

      if (cursorY > maxY) {
        advanceColumn();
      }
    }
  }

  pdf.save(fileName);
}

async function generateZinePdfV2Layout(sourceText, fileName, options = {}) {
  const {
    bodyFontFamily = 'times',
    coverFontFamily = bodyFontFamily,
    backCoverFontFamily = coverFontFamily,
    pasteFontFamily = coverFontFamily,
    debugFontFamily = 'helvetica',
    setupPdf,
  } = options;

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  if (setupPdf) {
    await setupPdf(pdf);
  }

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const cellWidth = pageWidth / 4;
  const cellHeight = pageHeight / 4;
  const cellPadding = 14;
  const fontSize = 10;
  const lineHeight = 13;

  const slotByPageNumber = {
    1: { row: 3, col: 2, rotate180: false },
    2: { row: 3, col: 3, rotate180: false },
    3: { row: 2, col: 3, rotate180: true },
    4: { row: 2, col: 2, rotate180: true },
    5: { row: 2, col: 1, rotate180: true },
    6: { row: 2, col: 0, rotate180: true },
    7: { row: 1, col: 0, rotate180: false },
    8: { row: 1, col: 1, rotate180: false },
    9: { row: 1, col: 2, rotate180: false },
    10: { row: 1, col: 3, rotate180: false },
    11: { row: 0, col: 3, rotate180: true },
    12: { row: 0, col: 2, rotate180: true },
  };
  const pasteBackCoverSlot = { row: 0, col: 0 };
  const pasteFrontCoverSlot = { row: 0, col: 1 };
  const frontCoverSlot = { row: 3, col: 1 };
  const backCoverSlot = { row: 3, col: 0 };
  const debugLabelByCell = {
    '0,0': 'PASTE',
    '0,1': 'PASTE',
    '0,2': '12',
    '0,3': '11',
    '1,0': '7',
    '1,1': '8',
    '1,2': '9',
    '1,3': '10',
    '2,0': '6',
    '2,1': '5',
    '2,2': '4',
    '2,3': '3',
    '3,0': 'BACK COVER',
    '3,1': 'FRONT COVER',
    '3,2': '1',
    '3,3': '2',
  };

  const queue = sourceText
    .split('\n')
    .map((line) => ({ text: line.trim(), isBlank: line.trim() === '' }));

  pdf.setFont(bodyFontFamily, 'normal');
  pdf.setFontSize(fontSize);

  // Vertical fold lines: light dotted (inner only)
  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(0.4);
  pdf.setLineDashPattern([1, 4], 0);
  for (let col = 1; col < 4; col += 1) {
    pdf.line(col * cellWidth, 0, col * cellWidth, pageHeight);
  }

  // Horizontal grid lines (inner only): very light dotted
  for (let row = 1; row < 4; row += 1) {
    pdf.line(0, row * cellHeight, pageWidth, row * cellHeight);
  }

  // Outer border: black dotted, stronger
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.8);
  pdf.setLineDashPattern([2, 3], 0);
  pdf.line(0, 0, pageWidth, 0);
  pdf.line(0, pageHeight, pageWidth, pageHeight);
  pdf.line(0, 0, 0, pageHeight);
  pdf.line(pageWidth, 0, pageWidth, pageHeight);

  pdf.setLineDashPattern([], 0);

  // Cut lines: gray dashed, prominent
  pdf.setDrawColor(150, 150, 150);
  pdf.setLineWidth(1.2);
  pdf.setLineDashPattern([8, 6], 0);
  pdf.line(0, cellHeight, cellWidth * 3, cellHeight);
  pdf.line(cellWidth, cellHeight * 2, cellWidth * 4, cellHeight * 2);
  pdf.line(0, cellHeight * 3, cellWidth * 3, cellHeight * 3);
  pdf.setLineDashPattern([], 0);

  pdf.setTextColor(0, 0, 0);

  const coverTextInset = 10;
  const coverTextWidth = cellWidth - coverTextInset * 2;

  // Front cover: match app UI header — helvetica bold, uppercase, wide tracking
  const frontCoverCharSpace = 2.5;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  const frontCoverCenterX = frontCoverSlot.col * cellWidth + cellWidth / 2;
  const frontCoverY = frontCoverSlot.row * cellHeight + cellHeight * 0.25;
  for (let i = 0; i < ZINE_FRONT_COVER_LINES.length; i += 1) {
    const line = ZINE_FRONT_COVER_LINES[i].toUpperCase();
    const wrappedLineGroup = pdf.splitTextToSize(line, coverTextWidth);
    for (let j = 0; j < wrappedLineGroup.length; j += 1) {
      const lineW = pdf.getTextWidth(wrappedLineGroup[j]);
      const totalCharSpace = frontCoverCharSpace * (wrappedLineGroup[j].length - 1);
      pdf.text(wrappedLineGroup[j], frontCoverCenterX - (lineW + totalCharSpace) / 2, frontCoverY + i * 20 + j * 18, { charSpace: frontCoverCharSpace });
    }
  }

  const backCoverLeftX = backCoverSlot.col * cellWidth + coverTextInset;
  const backCoverBaseY = backCoverSlot.row * cellHeight + cellHeight * 0.70;
  const backCoverLineGap = 13;
  pdf.setFontSize(10);
  for (let i = 0; i < ZINE_BACK_COVER_LINES.length; i += 1) {
    pdf.setFont(backCoverFontFamily, i === 2 ? 'italic' : 'normal');
    const wrappedLineGroup = pdf.splitTextToSize(ZINE_BACK_COVER_LINES[i], coverTextWidth);
    for (let j = 0; j < wrappedLineGroup.length; j += 1) {
      pdf.text(
        wrappedLineGroup[j],
        backCoverLeftX,
        backCoverBaseY + i * backCoverLineGap + j * 12,
        { align: 'left' }
      );
    }
  }
  pdf.setFont(coverFontFamily, 'normal');
  pdf.setFontSize(20);

  const pasteTextColor = [200, 200, 200];
  const pasteLineGap = 12;
  const drawPasteInstruction = (slot, text) => {
    const centerX = slot.col * cellWidth + cellWidth / 2;
    const centerY = slot.row * cellHeight + cellHeight * 0.50;
    pdf.setFont(pasteFontFamily, 'normal');
    pdf.setFontSize(10);
    const wrapped = pdf.splitTextToSize(text, coverTextWidth);
    const startY = centerY + ((wrapped.length - 1) * pasteLineGap) / 2;

    pdf.setTextColor(...pasteTextColor);
    for (let i = 0; i < wrapped.length; i += 1) {
      const lineWidth = pdf.getTextWidth(wrapped[i]);
      pdf.text(wrapped[i], centerX + lineWidth / 2, startY - i * pasteLineGap, { angle: 180 });
    }
    pdf.setTextColor(0, 0, 0);
    pdf.setFont(coverFontFamily, 'normal');
    pdf.setFontSize(20);
  };

  drawPasteInstruction(pasteBackCoverSlot, ZINE_PASTE_FRONT_COVER_TEXT);
  drawPasteInstruction(pasteFrontCoverSlot, ZINE_PASTE_BACK_COVER_TEXT);

  if (ENABLE_ZINE_GRID_DEBUG_LABELS) {
    pdf.setFont(debugFontFamily, 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(160, 160, 160);
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const label = debugLabelByCell[`${row},${col}`];
        if (!label) continue;
        const x = col * cellWidth + 6;
        const y = row * cellHeight + 10;
        pdf.text(label, x, y);
      }
    }
  }

  pdf.setFont(bodyFontFamily, 'normal');
  pdf.setFontSize(fontSize);
  pdf.setTextColor(0, 0, 0);

  const pageOrder = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  for (const pageNumber of pageOrder) {
    if (queue.length === 0) break;

    const slot = slotByPageNumber[pageNumber];
    if (!slot) continue;

    const cellX = slot.col * cellWidth;
    const cellY = slot.row * cellHeight;
    const textWidth = cellWidth - cellPadding * 2;
    const maxLines = Math.max(1, Math.floor((cellHeight - cellPadding * 2) / lineHeight));
    const renderedLines = [];

    while (queue.length > 0 && renderedLines.length < maxLines) {
      const current = queue[0];

      if (current.isBlank) {
        renderedLines.push('');
        queue.shift();
        continue;
      }

      const wrapped = pdf.splitTextToSize(current.text, textWidth);
      const remainingSlots = maxLines - renderedLines.length;

      if (wrapped.length <= remainingSlots) {
        renderedLines.push(...wrapped);
        queue.shift();
      } else {
        if (remainingSlots <= 0) break;
        renderedLines.push(...wrapped.slice(0, remainingSlots));
        queue[0] = {
          text: wrapped.slice(remainingSlots).join(' '),
          isBlank: false,
        };
      }
    }

    if (!slot.rotate180) {
      let y = cellY + cellPadding + fontSize;
      const x = cellX + cellPadding;
      for (const line of renderedLines) {
        if (line) {
          pdf.text(line, x, y);
        }
        y += lineHeight;
      }
    } else {
      let y = cellY + cellHeight - cellPadding;
      const x = cellX + cellWidth - cellPadding;
      for (const line of renderedLines) {
        if (line) {
          pdf.text(line, x, y, { angle: 180 });
        }
        y -= lineHeight;
      }
    }
  }

  pdf.save(fileName);
}

function generateZinePdfV2(sourceText, fileName) {
  return generateZinePdfV2Layout(sourceText, fileName);
}

async function generateZinePdfV2Lora(sourceText, fileName) {
  return generateZinePdfV2Layout(sourceText, fileName, {
    bodyFontFamily: ZINE_LORA_FONT_FAMILY,
    coverFontFamily: ZINE_LORA_FONT_FAMILY,
    backCoverFontFamily: ZINE_LORA_FONT_FAMILY,
    pasteFontFamily: ZINE_LORA_FONT_FAMILY,
    debugFontFamily: 'helvetica',
    setupPdf: async (pdf) => {
      await registerPdfFont(pdf, {
        url: ZINE_LORA_FONT_URL,
        vfsFileName: ZINE_LORA_FONT_VFS_NAME,
        fontFamily: ZINE_LORA_FONT_FAMILY,
        fontStyle: 'normal',
      });
      await registerPdfFont(pdf, {
        url: ZINE_LORA_ITALIC_FONT_URL,
        vfsFileName: ZINE_LORA_ITALIC_FONT_VFS_NAME,
        fontFamily: ZINE_LORA_FONT_FAMILY,
        fontStyle: 'italic',
      });
    },
  });
}

function resolveZinePdfStyle(stylePreference) {
  if (stylePreference === ZINE_PDF_STYLES.RANDOM) {
    const randomIndex = Math.floor(Math.random() * AVAILABLE_ZINE_PDF_STYLES.length);
    return AVAILABLE_ZINE_PDF_STYLES[randomIndex] ?? ZINE_PDF_STYLES.ZINE_V1;
  }

  if (AVAILABLE_ZINE_PDF_STYLES.includes(stylePreference)) {
    return stylePreference;
  }

  return ZINE_PDF_STYLES.ZINE_V1;
}

async function exportZinePdf({ sourceText, fileName, stylePreference }) {
  const resolvedStyle = resolveZinePdfStyle(stylePreference);

  switch (resolvedStyle) {
    case ZINE_PDF_STYLES.ZINE_V2_LORA:
      try {
        await generateZinePdfV2Lora(sourceText, fileName);
      } catch (error) {
        console.warn('Lora zine export failed, falling back to zine-v2.', error);
        await generateZinePdfV2(sourceText, fileName);
      }
      break;
    case ZINE_PDF_STYLES.ZINE_V2:
      await generateZinePdfV2(sourceText, fileName);
      break;
    case ZINE_PDF_STYLES.ZINE_V1:
    default:
      generateZinePdfV1(sourceText, fileName);
      break;
  }

  return resolvedStyle;
}

function buildGraph(sequences, variantsByText) {
  const rootFragment = sequences[0]?.[0];
  const rootText = rootFragment?.text ?? 'eu';
  const rootNormalizedText = rootFragment?.normalized_text ?? 'eu';

  const uniqueCount = variantsByText.size + 1;
  const gridSize = Math.max(MIN_GRID_SIZE, Math.ceil(Math.sqrt(uniqueCount)) * 2 + 1);
  const center = Math.floor(gridSize / 2);
  const grid = Array.from({ length: gridSize }, () => Array(gridSize).fill(null));
  const nodes = {
    root: {
      id: 'root',
      text: rootText,
      normalizedText: rootNormalizedText,
      x: center,
      y: center,
      next: new Set(),
      audioVariants: variantsByText.get(rootNormalizedText) ?? [],
    },
  };

  grid[center][center] = 'root';

  const findNodeId = (normalizedText) => {
    if (normalizedText === rootNormalizedText) return 'root';
    for (const node of Object.values(nodes)) {
      if (node.normalizedText === normalizedText) return node.id;
    }
    return null;
  };

  const getEmptyAdjacent = (cx, cy, preferredAngle) => {
    const neighbors = [
      [0, -1],
      [1, -1],
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
    ];
    let bestCell = null;
    let maxScore = -Infinity;

    for (const [nx, ny] of neighbors) {
      const px = cx + nx;
      const py = cy + ny;
      if (px >= 0 && px < gridSize && py >= 0 && py < gridSize && grid[py][px] === null) {
        const angleToNode = Math.atan2(py - center, px - center);
        let diff = Math.abs(angleToNode - preferredAngle);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        const score = -diff + Math.random() * 0.4;
        if (score > maxScore) {
          maxScore = score;
          bestCell = [px, py];
        }
      }
    }

    if (!bestCell) {
      for (let radius = 1; radius < gridSize; radius += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          for (let dy = -radius; dy <= radius; dy += 1) {
            const px = cx + dx;
            const py = cy + dy;
            if (px >= 0 && px < gridSize && py >= 0 && py < gridSize && grid[py][px] === null) {
              return [px, py];
            }
          }
        }
      }
    }

    return bestCell;
  };

  sequences.forEach((sequence, sequenceIndex) => {
    let prevId = 'root';
    const angle = (sequenceIndex / Math.max(sequences.length, 1)) * 2 * Math.PI;
    const startIndex = sequence[0]?.normalized_text === rootNormalizedText ? 1 : 0;

    for (let index = startIndex; index < sequence.length; index += 1) {
      const fragment = sequence[index];
      const existingId = findNodeId(fragment.normalized_text);

      if (existingId) {
        nodes[prevId].next.add(existingId);
        prevId = existingId;
        continue;
      }

      const id = createNodeId(fragment.normalized_text);
      const parentNode = nodes[prevId];
      const coordinates = getEmptyAdjacent(parentNode.x, parentNode.y, angle);

      if (!coordinates) continue;

      const [nx, ny] = coordinates;
      grid[ny][nx] = id;
      nodes[id] = {
        id,
        text: fragment.text,
        normalizedText: fragment.normalized_text,
        x: nx,
        y: ny,
        next: new Set(),
        audioVariants: variantsByText.get(fragment.normalized_text) ?? [],
      };
      nodes[prevId].next.add(id);
      prevId = id;
    }
  });

  for (const node of Object.values(nodes)) {
    node.next = Array.from(node.next);
  }

  return { nodes, grid, rootId: 'root', center, gridSize };
}

export default function App() {
  const [manifestEntries, setManifestEntries] = useState([]);
  const [datasetError, setDatasetError] = useState('');
  const [isDatasetLoading, setIsDatasetLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadDataset() {
      try {
        const response = await fetch(new URL('manifest.json', getDatasetBaseUrl()));
        if (!response.ok) {
          throw new Error(`Nao foi possivel carregar a base de audio (${response.status}).`);
        }

        const payload = await response.json();
        if (!Array.isArray(payload)) {
          throw new Error('O manifest.json nao tem o formato esperado.');
        }

        if (!isMounted) return;
        setManifestEntries(payload);
        setDatasetError('');
      } catch (error) {
        if (!isMounted) return;
        setManifestEntries([]);
        setDatasetError(error instanceof Error ? error.message : 'Falha ao carregar a base de audio.');
      } finally {
        if (isMounted) {
          setIsDatasetLoading(false);
        }
      }
    }

    void loadDataset();

    return () => {
      isMounted = false;
    };
  }, []);

  const { sequences, variantsByText } = useMemo(() => buildSentenceData(manifestEntries), [manifestEntries]);
  const graph = useMemo(() => {
    if (manifestEntries.length === 0) {
      return createEmptyGraph();
    }

    return buildGraph(sequences, variantsByText);
  }, [manifestEntries, sequences, variantsByText]);
  const { nodes, grid, rootId, center, gridSize } = graph;
  const paletteVars = {
    '--color-bg-main': APP_PALETTE.bgMain,
    '--color-bg-panel': APP_PALETTE.bgPanel,
    '--color-bg-panel-soft': APP_PALETTE.bgPanelSoft,
    '--color-bg-surface': APP_PALETTE.bgSurface,
    '--color-bg-accent': APP_PALETTE.bgAccent,
    '--color-border': APP_PALETTE.border,
    '--color-border-soft': APP_PALETTE.borderSoft,
    '--color-border-faint': APP_PALETTE.borderFaint,
    '--color-border-hover': APP_PALETTE.borderHover,
    '--color-green-muted': APP_PALETTE.greenMuted,
    '--color-green-muted-soft': APP_PALETTE.greenMutedSoft,
    '--color-green-bright': APP_PALETTE.greenBright,
    '--color-green-glow-soft': APP_PALETTE.greenGlowSoft,
    '--color-green-glow-strong': APP_PALETTE.greenGlowStrong,
    '--color-maroon': APP_PALETTE.maroon,
    '--color-pink': APP_PALETTE.pink,
    '--color-eu-bg': APP_PALETTE.euBg,
    '--color-eu-color': APP_PALETTE.euColor,
  };

  const [revealedIds, setRevealedIds] = useState(() => new Set([rootId]));
  const [clickableIds, setClickableIds] = useState(() => new Set(nodes[rootId]?.next ?? []));
  const [activeId, setActiveId] = useState(rootId);
  const [showInfo, setShowInfo] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [isAutoplay, setIsAutoplay] = useState(false);
  const [traversalRecord, setTraversalRecord] = useState(() => loadTraversalRecordFromSession());
  const [scrollHints, setScrollHints] = useState({
    left: false,
    right: false,
    up: false,
    down: false,
  });

  const autoplayTimerRef = useRef(null);
  const mainContainerRef = useRef(null);
  const rootCellRef = useRef(null);
  const activeAudioRef = useRef(new Set());
  const nodeRefsMap = useRef(new Map());
  const headerRef = useRef(null);

  const appendFragmentToTraversalRecord = (fragmentText) => {
    const normalizedText = String(fragmentText ?? '').trim();
    if (!normalizedText) return;

    setTraversalRecord((prev) => {
      const nextFragments = [...prev.fragments, normalizedText];
      const nextRecord = {
        ...prev,
        updatedAt: new Date().toISOString(),
        fragments: nextFragments,
        pdfText: buildPdfTextFromFragments(nextFragments),
      };
      return nextRecord;
    });
  };

  useEffect(() => {
    setActiveId(rootId);
    setRevealedIds(new Set([rootId]));
    setClickableIds(new Set(nodes[rootId]?.next ?? []));
  }, [nodes, rootId]);

  useEffect(() => {
    return () => {
      for (const audio of activeAudioRef.current) {
        audio.pause();
        audio.src = '';
      }
      activeAudioRef.current.clear();
      if (autoplayTimerRef.current) clearTimeout(autoplayTimerRef.current);
    };
  }, []);

  useEffect(() => {
    persistTraversalRecord(traversalRecord);
  }, [traversalRecord]);

  useLayoutEffect(() => {
    const container = mainContainerRef.current;
    const rootCell = rootCellRef.current;

    if (!container || !rootCell) return;

    const updateScrollHints = () => {
      const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const threshold = 12;

      setScrollHints({
        left: container.scrollLeft > threshold,
        right: container.scrollLeft < maxScrollLeft - threshold,
        up: container.scrollTop > threshold,
        down: container.scrollTop < maxScrollTop - threshold,
      });
    };

    const centerRootCell = () => {
      rootCell.scrollIntoView({
        block: 'center',
        inline: 'center',
        behavior: 'auto',
      });
      window.requestAnimationFrame(updateScrollHints);
    };

    const rafId = window.requestAnimationFrame(centerRootCell);
    const timeoutId = window.setTimeout(centerRootCell, 250);

    container.addEventListener('scroll', updateScrollHints, { passive: true });
    window.addEventListener('resize', centerRootCell);
    window.addEventListener('orientationchange', centerRootCell);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
      container.removeEventListener('scroll', updateScrollHints);
      window.removeEventListener('resize', centerRootCell);
      window.removeEventListener('orientationchange', centerRootCell);
    };
  }, [grid]);

  useEffect(() => {
    if (isAutoplay && clickableIds.size > 0) {
      const nextDelay = 1500 + Math.random() * 1000;
      autoplayTimerRef.current = setTimeout(() => {
        const options = Array.from(clickableIds);
        const randomChoice = options[Math.floor(Math.random() * options.length)];
        handleNodeClick(randomChoice);
      }, nextDelay);
    } else if (isAutoplay && clickableIds.size === 0) {
      autoplayTimerRef.current = setTimeout(() => {
        handleNodeClick(rootId);
      }, 3000);
    }

    return () => {
      if (autoplayTimerRef.current) clearTimeout(autoplayTimerRef.current);
    };
  }, [isAutoplay, clickableIds, rootId]);

  const playNodeEffect = (node) => {
    if (!audioEnabled) return;

    const variants = node.audioVariants ?? [];
    if (variants.length === 0) return;

    const playableVariants = variants.filter((variant) => variant.audioUrl);
    if (playableVariants.length === 0) return;

    const selectedVariant =
      playableVariants[Math.floor(Math.random() * playableVariants.length)];
    const audio = new Audio(selectedVariant.audioUrl);
    activeAudioRef.current.add(audio);
    audio.addEventListener('ended', () => {
      activeAudioRef.current.delete(audio);
    }, { once: true });
    audio.addEventListener('error', () => {
      activeAudioRef.current.delete(audio);
    }, { once: true });
    void audio.play().catch(() => {});
  };

  const handleDownloadTraversalJson = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const exportRecord = {
      ...traversalRecord,
      pdfText: buildPdfTextFromFragments(traversalRecord.fragments),
    };
    const payload = JSON.stringify(exportRecord, null, 2);
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = USER_TRAVERSAL_STORAGE_KEY;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(objectUrl);
  };

  const handleDownloadTraversalPdf = async () => {
    const sourceText = buildPdfTextFromFragments(traversalRecord.fragments).trim();

    if (!sourceText) return;
    await exportZinePdf({
      sourceText,
      fileName: USER_TRAVERSAL_PDF_FILE_NAME,
      stylePreference: ACTIVE_ZINE_PDF_STYLE,
    });
  };

  // End-of-faixa scroll: when no more clickable nodes remain, center back on "eu" (root).
  useEffect(() => {
    if (clickableIds.size !== 0 || activeId === rootId) return;
    const container = mainContainerRef.current;
    const rootEl = rootCellRef.current;
    if (!container || !rootEl) return;

    const timer = setTimeout(() => {
      const containerRect = container.getBoundingClientRect();
      const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 0;
      const elRect = rootEl.getBoundingClientRect();
      const elCenterY = elRect.top + elRect.height / 2;
      const elCenterX = elRect.left + elRect.width / 2;
      const visibleHeight = containerRect.height - headerHeight;
      const targetScrollTop = container.scrollTop + elCenterY - (containerRect.top + headerHeight + visibleHeight / 2);
      const targetScrollLeft = container.scrollLeft + elCenterX - (containerRect.left + containerRect.width / 2);
      smoothScrollTo(container, targetScrollLeft, targetScrollTop, 900);
    }, 2000);
    return () => clearTimeout(timer);
  }, [clickableIds]);

  // Smart scroll: after a click, if most next clickable nodes are outside the viewport,
  // smooth-scroll to center the active node. Runs only when activeId changes (not on root reset).
  useEffect(() => {
    if (activeId === rootId) return;
    const container = mainContainerRef.current;
    const activeEl = nodeRefsMap.current.get(activeId);
    if (!container || !activeEl) return;

    const nextIds = Array.from(clickableIds);
    if (nextIds.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 0;
    const effectiveTop = containerRect.top + headerHeight;

    const visibleCount = nextIds.filter((nid) => {
      const el = nodeRefsMap.current.get(nid);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return (
        r.top >= effectiveTop &&
        r.bottom <= containerRect.bottom &&
        r.left >= containerRect.left &&
        r.right <= containerRect.right
      );
    }).length;

    const visibleRatio = visibleCount / nextIds.length;
    if (visibleRatio < 0.5) {
      // Manually scroll so active node ends up centered in the visible area below the header
      const elRect = activeEl.getBoundingClientRect();
      const elCenterY = elRect.top + elRect.height / 2;
      const elCenterX = elRect.left + elRect.width / 2;
      const visibleHeight = containerRect.height - headerHeight;
      const targetScrollTop = container.scrollTop + elCenterY - (containerRect.top + headerHeight + visibleHeight / 2);
      const targetScrollLeft = container.scrollLeft + elCenterX - (containerRect.left + containerRect.width / 2);
      smoothScrollTo(container, targetScrollLeft, targetScrollTop, 600);
    }
  }, [activeId]);

  const handleNodeClick = (id, options = {}) => {
    const { recordTraversal = false } = options;
    const node = nodes[id];
    if (!node) return;

    if (id === rootId) {
      setActiveId(rootId);
      setClickableIds(new Set(nodes[rootId]?.next ?? []));
      setRevealedIds(new Set([rootId]));
      playNodeEffect(nodes[rootId]);
      if (recordTraversal) {
        appendFragmentToTraversalRecord(nodes[rootId]?.text ?? '');
      }
      return;
    }

    if (clickableIds.has(id)) {
      setActiveId(id);
      setRevealedIds((prev) => new Set(prev).add(id));
      setClickableIds(new Set(node.next));
      playNodeEffect(node);
      if (recordTraversal) {
        appendFragmentToTraversalRecord(node.text);
      }
    }
  };

  return (
    <div
      className="h-[100dvh] w-full bg-[var(--color-bg-main)] text-[var(--color-pink)] font-sans selection:bg-[var(--color-green-bright)] selection:text-white flex flex-col overflow-hidden"
      style={paletteVars}
    >
      <header
        ref={headerRef}
        className="fixed top-0 left-0 right-0 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 md:px-5 md:pt-5 md:pb-5 flex justify-between items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-panel)] z-30 shadow-2xl"
      >
        <div className="flex flex-col min-w-0 flex-1">
          <h1 className="text-[10px] md:text-lg font-bold tracking-[0.1em] md:tracking-[0.3em] uppercase text-[var(--color-green-muted)]">
            Faixas de Rodagem do Pensamento
          </h1>
          <span className="text-[16px] opacity-80 ">2026 ✺ Terhi Marttila</span>
          {!isAutoplay && (
            <span className="text-[10px] italic uppercase tracking-[0.08em] text-[var(--color-green-muted)] opacity-80">
              Clique nas faixas
            </span>
          )}

          <div className="flex items-center gap-2 mt-1">
            {isAutoplay && (
              <span className="text-[9px] bg-[var(--color-green-muted-soft)] text-[var(--color-green-muted)] px-2 py-0.5 rounded animate-pulse font-bold tracking-tighter">
                MODO AUTOPLAY
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-1 md:gap-3 flex-shrink-0">
          <button
            onClick={handleDownloadTraversalPdf}
            className="px-2 py-2 md:px-3 md:py-3 bg-black/40 hover:bg-[var(--color-border)] rounded-full text-[10px] md:text-xs font-bold tracking-[0.08em] uppercase text-[var(--color-green-muted)] transition-colors"
            title="Exportar PDF da sessao"
          >
            zine
          </button>

          <button
            onClick={() => setIsAutoplay(!isAutoplay)}
            className={`p-2 md:p-3 rounded-full transition-all flex items-center gap-2 ${
              isAutoplay
                ? 'text-[var(--color-green-bright)] bg-[var(--color-bg-accent)] shadow-[0_0_15px_var(--color-green-glow-soft)]'
                : 'text-gray-400 bg-black/40 hover:text-white'
            }`}
            title={isAutoplay ? 'Pausar Autoplay' : 'Iniciar Autoplay'}
          >
            {isAutoplay ? (
              <Pause size={16} className="md:w-5 md:h-5" fill="currentColor" />
            ) : (
              <Play size={16} className="md:w-5 md:h-5" fill="currentColor" />
            )}
          </button>

          <button
            onClick={() => handleNodeClick(rootId)}
            className="p-2 md:p-3 bg-black/40 hover:bg-[var(--color-border)] rounded-full text-[var(--color-green-muted)] transition-colors"
            title="Reiniciar"
          >
            <RotateCcw size={16} className="md:w-5 md:h-5" />
          </button>

          <button
            onClick={() => setAudioEnabled(!audioEnabled)}
            className={`p-2 md:p-3 rounded-full transition-all ${
              audioEnabled ? 'text-[var(--color-green-bright)] bg-[var(--color-bg-accent)]' : 'text-gray-600 bg-black'
            }`}
          >
            {audioEnabled ? (
              <Volume2 size={16} className="md:w-6 md:h-6" />
            ) : (
              <VolumeX size={16} className="md:w-6 md:h-6" />
            )}
          </button>

          <button
            onClick={() => setShowInfo(true)}
            className="p-2 md:p-3 hover:bg-[var(--color-border)] rounded-full text-[var(--color-green-muted)] transition-colors"
          >
            <Info size={16} className="md:w-6 md:h-6" />
          </button>
        </div>
      </header>

      <main
        ref={mainContainerRef}
        className="relative flex-1 overflow-auto bg-[radial-gradient(circle_at_center,_var(--color-bg-surface)_0%,_var(--color-bg-main)_100%)] flex items-center justify-center p-4 md:p-12 pt-24 md:pt-28 pb-24 md:pb-28"
      >
        {(isDatasetLoading || datasetError) && (
          <div className="absolute top-24 left-1/2 -translate-x-1/2 z-20 px-4 py-2 border border-[var(--color-border)] bg-[var(--color-bg-panel-soft)] text-xs md:text-sm uppercase tracking-[0.15em] text-[var(--color-green-muted)]">
            {isDatasetLoading ? 'A carregar a base de audio...' : datasetError}
          </div>
        )}
        {scrollHints.left && (
          <div className="hidden pointer-events-none sticky left-5 md:left-8 top-1/2 z-20 w-0 -translate-y-1/2 text-[var(--color-green-bright)] opacity-90 text-base md:text-lg drop-shadow-[0_0_8px_var(--color-green-glow-soft)]">
            ←
          </div>
        )}
        {scrollHints.right && (
          <div className="hidden pointer-events-none sticky left-[calc(100%-1.25rem)] md:left-[calc(100%-2rem)] top-1/2 z-20 w-0 -translate-y-1/2 text-[var(--color-green-bright)] opacity-90 text-base md:text-lg drop-shadow-[0_0_8px_var(--color-green-glow-soft)]">
            →
          </div>
        )}
        {scrollHints.up && (
          <div className="hidden pointer-events-none fixed top-24 md:top-32 left-1/2 z-40 -translate-x-1/2 text-[var(--color-green-bright)] opacity-90 text-base md:text-lg drop-shadow-[0_0_8px_var(--color-green-glow-soft)]">
            ↑
          </div>
        )}
        {scrollHints.down && (
          <div className="hidden pointer-events-none fixed bottom-5 md:bottom-8 left-1/2 z-40 -translate-x-1/2 text-[var(--color-green-bright)] opacity-90 text-base md:text-lg drop-shadow-[0_0_8px_var(--color-green-glow-soft)]">
            ↓
          </div>
        )}
        <div
          className={`grid transition-opacity duration-1000 ${
            isAutoplay ? 'opacity-90' : 'opacity-100'
          }`}
          style={{
            gridTemplateColumns: `repeat(${gridSize}, minmax(60px, 1fr))`,
            gridTemplateRows: `repeat(${gridSize}, minmax(60px, 1fr))`,
            width: 'min(98vw, 1100px)',
            aspectRatio: '1/1',
            gap: '4px',
          }}
        >
          {grid.map((row, y) =>
            row.map((nodeId, x) => {
              const node = nodeId ? nodes[nodeId] : null;
              const isRoot = nodeId === rootId;
              const isRevealed = revealedIds.has(nodeId);
              const isClickable = clickableIds.has(nodeId);
              const isActive = activeId === nodeId;

              let cellClasses =
                'border border-[var(--color-border-faint)] rounded-full flex items-center justify-center transition-all duration-500 relative text-center ';
              let content = null;

              if (nodeId) {
                if (isRoot && isActive) {
                  cellClasses +=
                    'bg-[var(--color-eu-bg)] z-10 scale-110 shadow-[0_0_40px_var(--color-eu-bg)] text-[var(--color-eu-color)] font-black cursor-pointer';
                  content = node.text;
                } else if (isActive) {
                  cellClasses +=
                    'bg-[var(--color-bg-accent)] z-10 scale-110 shadow-[0_0_40px_var(--color-green-glow-strong)] text-[var(--color-green-bright)] font-black';
                  content = node.text;
                } else if (isRoot) {
                  cellClasses += 'bg-[var(--color-eu-bg)] text-[var(--color-eu-color)] font-medium cursor-pointer';
                  content = node.text;
                } else if (isClickable) {
                  cellClasses += 'cursor-pointer hover:bg-[var(--color-border-hover)] text-[var(--color-maroon)] font-semibold';
                  content = (
                    <span className={`scale-105 inline-block ${isAutoplay ? 'opacity-60' : 'animate-pulse'}`}>
                      {node.text}
                    </span>
                  );
                } else if (isRevealed) {
                  cellClasses += 'opacity-40 text-[var(--color-maroon)] cursor-pointer hover:opacity-100 font-medium';
                  content = node.text;
                }
              }

              return (
                <div
                  key={`${x}-${y}`}
                  ref={(el) => {
                    if (isRoot) rootCellRef.current = el;
                    if (nodeId) {
                      if (el) nodeRefsMap.current.set(nodeId, el);
                      else nodeRefsMap.current.delete(nodeId);
                    }
                  }}
                  className={cellClasses}
                  onClick={() => !isAutoplay && nodeId && handleNodeClick(nodeId, { recordTraversal: true })}
                >
                  {nodeId && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 z-0 flex items-center justify-center -translate-y-[0.08em] md:translate-y-0 text-[var(--color-border-faint)] opacity-40 select-none pointer-events-none leading-none text-[5.6rem] md:text-[4.5rem]"
                    >
                      ✺
                    </span>
                  )}
                  {content && (
                    <span
                      className={`relative z-10 leading-tight px-1 select-none transition-all ${
                        isActive ? 'text-[19px] md:text-[27px]' : 'text-[17px] md:text-[23px]'
                      }`}
                    >
                      {content}
                    </span>
                  )}
                  {isClickable && (
                    <div className="absolute top-0 right-0 w-2 h-2 bg-[var(--color-green-bright)] rounded-full m-1 shadow-[0_0_8px_var(--color-green-bright)]" />
                  )}
                </div>
              );
            })
          )}
        </div>
      </main>

      {/* Footer kept here for possible restoration later.
      <footer className="fixed bottom-0 left-0 right-0 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-5 md:pt-5 md:pb-5 bg-[var(--color-bg-panel)] border-t border-[var(--color-border)] flex justify-between items-center text-base tracking-[0.05em] md:tracking-[0.1em] uppercase opacity-100 z-10">
        <span>Clique nas faixas.</span>
      </footer>
      */}


      {showInfo && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-lg flex items-center justify-center p-4 md:p-6 z-50 overflow-y-auto">
          <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] p-6 md:p-10 max-w-2xl w-full shadow-2xl relative my-auto">
            <h2 className="text-[var(--color-green-bright)] text-lg md:text-2xl font-bold mb-4 md:mb-6 tracking-widest uppercase border-b border-[var(--color-border)] pb-2">
              Faixas de Rodagem do Pensamento
            </h2>
            <div className="text-sm md:text-base space-y-3 md:space-y-5 text-[var(--color-pink)] leading-relaxed">
              <p>
                A escrita performativa em voz parte sempre do “eu, uma vez". A partir daquele momento, o pensamento segue
                o trilho menos viscoso no cérebro de estrangeiro até encontrar a faixa mais provável de rodagem do
                pensamento.
              </p>
              <p>
                As faixas apresentadas aqui foram recolhidas ao longo de cerca de quatro semanas em Março-Abril no âmbito das residências artísticas online do Balleteatro.
              </p>
              <p>
                A interface permite navegar as faixas conforme interesse do leitor-ouvinte. Ao clicar num fragmento, ouve-se a voz e aparecem as faixas possíveis, clicáveis em ordens multilineares. É sempre possível voltar ao “eu” para recomeçar a leitura.
              </p>
              <p>
                O <strong>Modo Autoplay</strong> permite ceder a agência na escolha da faixa de rodagem ao acaso. Sempre que encontra uma bifurcação (uma
                palavra comum a vários pensamentos), o sistema escolhe um caminho ao acaso e no final, repete ao partir do eu, tracejando um trilho
                infinito nos pensamentos.
              </p>
              <p className="pt-3 md:pt-4 border-t border-[var(--color-border)] text-[10px] md:text-[12px] opacity-100">
                Desenvolvido para{' '}
                <a
                  target="_blank"
                  rel="noreferrer"
                  href="https://bt.balleteatro.pt/Residencias-Artisticas-online/terhimarttila/"
                  className="cursor-pointer underline decoration-[var(--color-green-bright)] decoration-2 underline-offset-2 text-[var(--color-green-bright)] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-green-bright)]"
                >
                  Balleteatro - Residências Artísticas Online - Março 2026 - Terhi Marttila
                </a>
                <br />
                Música original por: Diogo Cocharro
                <br />
                Código: Gemini3, Claude Sonnet 4.5 e Terhi Marttila
                <br />
                Agradeçimentos: Jorge Gonçalves, Né Barros, Watson Hartsoe, Jay David Bolter
              </p>
            </div>
            <button
              onClick={() => setShowInfo(false)}
              className="mt-6 md:mt-10 w-full py-3 md:py-4 border border-[var(--color-green-bright)] text-[var(--color-green-bright)] hover:bg-[var(--color-green-bright)] hover:text-black transition-all font-bold uppercase text-xs tracking-[0.2em] md:tracking-[0.3em]"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
