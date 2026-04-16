import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Info, Volume2, VolumeX, Play, Pause, RotateCcw } from 'lucide-react';

const MIN_GRID_SIZE = 15;
const DATASET_ROOT = `${import.meta.env.BASE_URL}audio-library/current/`;
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

  const autoplayTimerRef = useRef(null);
  const mainContainerRef = useRef(null);
  const activeAudioRef = useRef(new Set());

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
    if (mainContainerRef.current) {
      const container = mainContainerRef.current;
      container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
      container.scrollTop = (container.scrollHeight - container.clientHeight) / 2;
    }
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

  const handleNodeClick = (id) => {
    const node = nodes[id];
    if (!node) return;

    if (id === rootId) {
      setActiveId(rootId);
      setClickableIds(new Set(nodes[rootId]?.next ?? []));
      setRevealedIds(new Set([rootId]));
      playNodeEffect(nodes[rootId]);
      return;
    }

    if (clickableIds.has(id)) {
      setActiveId(id);
      setRevealedIds((prev) => new Set(prev).add(id));
      setClickableIds(new Set(node.next));
      playNodeEffect(node);
    }
  };

  return (
    <div
      className="min-h-screen bg-[var(--color-bg-main)] text-[var(--color-pink)] font-sans selection:bg-[var(--color-green-bright)] selection:text-white flex flex-col overflow-hidden"
      style={paletteVars}
    >
      <header className="fixed top-0 left-0 right-0 p-2 md:p-5 flex justify-between items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-panel)] z-30 shadow-2xl">
        <div className="flex flex-col min-w-0 flex-1">
          <h1 className="text-[10px] md:text-lg font-bold tracking-[0.1em] md:tracking-[0.3em] uppercase text-[var(--color-green-muted)]">
            Faixas de Rodagem do Pensamento
          </h1>
          <span className="text-[16px] opacity-80 ">2026 ✺ Terhi Marttila</span>
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
        className="flex-1 overflow-auto bg-[radial-gradient(circle_at_center,_var(--color-bg-surface)_0%,_var(--color-bg-main)_100%)] flex items-center justify-center p-4 md:p-12 pt-20 md:pt-24 pb-24"
      >
        {(isDatasetLoading || datasetError) && (
          <div className="absolute top-24 left-1/2 -translate-x-1/2 z-20 px-4 py-2 border border-[var(--color-border)] bg-[var(--color-bg-panel-soft)] text-xs md:text-sm uppercase tracking-[0.15em] text-[var(--color-green-muted)]">
            {isDatasetLoading ? 'A carregar a base de audio...' : datasetError}
          </div>
        )}
        <div
          className={`grid border-t border-l border-[var(--color-border-soft)] shadow-2xl bg-black/30 backdrop-blur-sm transition-opacity duration-1000 ${
            isAutoplay ? 'opacity-90' : 'opacity-100'
          }`}
          style={{
            gridTemplateColumns: `repeat(${gridSize}, minmax(60px, 1fr))`,
            width: 'min(98vw, 1100px)',
            aspectRatio: '1/1',
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
                'border-b border-r border-[var(--color-border-faint)] flex items-center justify-center transition-all duration-500 relative text-center ';
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
                  className={cellClasses}
                  onClick={() => !isAutoplay && nodeId && handleNodeClick(nodeId)}
                >
                  {content && (
                    <span
                      className={`leading-tight px-1 select-none transition-all ${
                        isActive ? 'text-sm md:text-xl' : 'text-xs md:text-base'
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

      <footer className="fixed bottom-0 left-0 right-0 p-3 md:p-5 bg-[var(--color-bg-panel)] border-t border-[var(--color-border)] flex justify-between items-center text-base tracking-[0.05em] md:tracking-[0.1em] uppercase opacity-100 z-10">
        <span>Clique nas palavras cintilantes para navegar. Clique no "eu" para recomeçar.</span>
      </footer>

      {showInfo && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-lg flex items-center justify-center p-4 md:p-6 z-50 overflow-y-auto">
          <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] p-6 md:p-10 max-w-2xl w-full shadow-2xl relative my-auto">
            <h2 className="text-[var(--color-green-bright)] text-lg md:text-2xl font-bold mb-4 md:mb-6 tracking-widest uppercase border-b border-[var(--color-border)] pb-2">
              Faixas de Rodagem do Pensamento
            </h2>
            <div className="text-sm md:text-base space-y-3 md:space-y-5 text-[var(--color-pink)] leading-relaxed">
              <p>
                A escrita performativa em voz parte sempre do “eu”, seguindo a tradição feminista da autoficção e da
                escrita confessional. Da “eu” segue-se sempre “uma vez”. A partir daquele momento, o pensamento segue
                o trilho menos viscoso no cérebro de estrangeiro até encontrar a faixa mais provável de rodagem do
                pensamento.
              </p>
              <p>
                A interface permite navegar os fragmentos conforme interesse do leitor-ouvinte. Ao clicar numa
                escolha, ouve-se a voz e aparecem trilhos possíveis, clicáveis em ordens multilineares. É sempre
                possível voltar ao “eu” para recomeçar a leitura.
              </p>
              <p>
                O <strong>Modo Autoplay</strong> transforma esta rede numa sistema performativo autónomo. Ao ativar o
                play, a aplicação navega sozinha pelas faixas de rodagem. Sempre que encontra uma bifurcação (uma
                palavra comum a vários pensamentos), o sistema escolhe um caminho ao acaso, tracejando um trilho
                infinito nos pensamentos.
              </p>
              <p className="pt-3 md:pt-4 border-t border-[var(--color-border)] text-[10px] md:text-[12px] opacity-100">
                Desenvolvido para Balleteatro - Residências Artísticas Online - Março 2026
                <br />
                Performance: Terhi Marttila
                <br />
                Sonoplastia: Diogo Cocharro
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
