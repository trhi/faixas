import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Info, Volume2, VolumeX, Play, Pause, RotateCcw } from 'lucide-react';

/**
 * --- BASE DE DADOS DE POEMAS ---
 */
const poemData = [
  ["eu", "uma vez", "caminhei", "na praia", "e o vento", "me deu asas", "e voei", "sem querer", "além de mim", "e além", "vi a praia", "de cima", "para baixo", "sem olhar", "muito bem"],
  ["eu", "uma vez", "pensei", "naquilo", "que não devia pensar", "e ri me", "a pensar", "naquilo"],
  ["eu", "uma vez", "cansada", "sem vontade", "o peso da cabeça", "a pesar", "mais de que o corpo", "apesar", "do seu tamanho"],
  ["eu", "uma vez", "fechei", "os olhos", "e senti as lágrimas", "dor no pescoço", "garganta colada", "ponto final"],
  ["eu", "uma vez", "vi", "um pombo", "atravessar", "a rua", "na passadeira", "o pescoço", "a mexer", "os pés", "un robô", "à procura", "da comida"],
  ["eu", "uma vez", "olhei", "para o céu", "muito azul", "ponto final"],
  ["eu", "uma vez", "respirei", "fundo", "e pensei", "bem", "é isso"],
  ["eu", "uma vez", "encontrei", "uma folha", "linda", "amarela", "entre os meus dedos", "fiz a folha rodar", "linda"],
  ["eu", "uma vez", "pensei", "nos outros", "a pensar nisso", "e fiquei parada", "com tantos olhares", "imaginários"],
  ["eu", "uma vez", "senti", "uma dor", "no joelho", "sentada", "não sei como", "numa cadeira", "torcida", "mexi"],
  ["eu", "uma vez", "vi", "cores", "à minha frente", "ponto final"],
  ["eu", "uma vez", "caminhei", "no bairro", "e pensei", "lindo"],
  ["eu", "uma vez", "caminhei", "e tentei", "olhar para cima", "para ver", "melhor", "aquilo", "que lá estava"],
  ["eu", "uma vez", "caminhei", "e senti", "as pernas", "pesadas"],
  ["eu", "uma vez", "olhei", "para ela", "e", "pensei", "muito bem"],
  ["eu", "uma vez", "achei", "melhor", "não pensar", "muito", "no assunto"]
];

const GRID_SIZE = 15; 
const CENTER = 7;

export default function App() {
  const [nodes, setNodes] = useState({});
  const [grid, setGrid] = useState([]);
  const [revealedIds, setRevealedIds] = useState(new Set(['root']));
  const [clickableIds, setClickableIds] = useState(new Set());
  const [activeId, setActiveId] = useState('root');
  const [showInfo, setShowInfo] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [isAutoplay, setIsAutoplay] = useState(false);
  
  const audioCtxRef = useRef(null);
  const autoplayTimerRef = useRef(null);
  const mainContainerRef = useRef(null);

  useMemo(() => {
    const newGrid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));
    const newNodes = {
      'root': { id: 'root', text: 'eu', x: CENTER, y: CENTER, next: new Set() }
    };
    newGrid[CENTER][CENTER] = 'root';

    const findGlobalNodeId = (text) => {
      for (const id in newNodes) {
        if (newNodes[id].text === text) return id;
      }
      return null;
    };

    const getEmptyAdjacent = (cx, cy, preferredAngle) => {
      const neighbors = [[0,-1], [1,-1], [1,0], [1,1], [0,1], [-1,1], [-1,0], [-1,-1]];
      let bestCell = null;
      let maxScore = -Infinity;

      for (let [nx, ny] of neighbors) {
        let px = cx + nx;
        let py = cy + ny;
        if (px >= 0 && px < GRID_SIZE && py >= 0 && py < GRID_SIZE && newGrid[py][px] === null) {
          let angleToNode = Math.atan2(py - CENTER, px - CENTER);
          let diff = Math.abs(angleToNode - preferredAngle);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          let score = -diff + (Math.random() * 0.4);
          if (score > maxScore) {
            maxScore = score;
            bestCell = [px, py];
          }
        }
      }
      
      if (!bestCell) {
        for(let r = 1; r < GRID_SIZE; r++) {
          for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
              let px = cx + dx, py = cy + dy;
              if (px >= 0 && px < GRID_SIZE && py >= 0 && py < GRID_SIZE && newGrid[py][px] === null) return [px, py];
            }
          }
        }
      }
      return bestCell;
    };

    poemData.forEach((poem, pIdx) => {
      let prevId = 'root';
      const angle = (pIdx / poemData.length) * 2 * Math.PI;
      for (let i = 1; i < poem.length; i++) {
        const word = poem[i];
        let existingId = findGlobalNodeId(word);
        if (existingId) {
          newNodes[prevId].next.add(existingId);
          prevId = existingId;
        } else {
          const id = `node_${word}_${Math.random().toString(36).substr(2, 5)}`;
          const parentNode = newNodes[prevId];
          let [nx, ny] = getEmptyAdjacent(parentNode.x, parentNode.y, angle);
          if (nx !== null) {
            newGrid[ny][nx] = id;
            newNodes[id] = { id, text: word, x: nx, y: ny, next: new Set() };
            newNodes[prevId].next.add(id);
            prevId = id;
          }
        }
      }
    });

    Object.keys(newNodes).forEach(key => {
      newNodes[key].next = Array.from(newNodes[key].next);
    });

    setGrid(newGrid);
    setNodes(newNodes);
  }, []);

  useEffect(() => {
    if (nodes['root']) setClickableIds(new Set(nodes['root'].next));
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtxRef.current = new AudioContext();
    return () => {
      if (audioCtxRef.current) audioCtxRef.current.close();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      if (autoplayTimerRef.current) clearTimeout(autoplayTimerRef.current);
    };
  }, [nodes]);

  // Center the grid on the "eu" node when the page loads (important for mobile)
  useEffect(() => {
    if (mainContainerRef.current) {
      const container = mainContainerRef.current;
      // Scroll to center of the scrollable area
      container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
      container.scrollTop = (container.scrollHeight - container.clientHeight) / 2;
    }
  }, [grid]);

  // Lógica de Autoplay
  useEffect(() => {
    if (isAutoplay && clickableIds.size > 0) {
      const nextDelay = 1500 + Math.random() * 1000; // Tempo variável entre palavras
      autoplayTimerRef.current = setTimeout(() => {
        const options = Array.from(clickableIds);
        const randomChoice = options[Math.floor(Math.random() * options.length)];
        handleNodeClick(randomChoice);
      }, nextDelay);
    } else if (isAutoplay && clickableIds.size === 0) {
      // Se chegar ao fim de uma frase, volta ao início após uma pausa
      autoplayTimerRef.current = setTimeout(() => {
        handleNodeClick('root');
      }, 3000);
    }
    return () => {
      if (autoplayTimerRef.current) clearTimeout(autoplayTimerRef.current);
    };
  }, [isAutoplay, clickableIds]);

  const playNodeEffect = (node) => {
    if (!audioEnabled) return;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(node.text);
      utterance.lang = 'pt-PT';
      utterance.rate = 0.85;
      window.speechSynthesis.speak(utterance);
    }
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
      const osc = audioCtxRef.current.createOscillator();
      const gain = audioCtxRef.current.createGain();
      const dist = Math.sqrt(Math.pow(node.x - CENTER, 2) + Math.pow(node.y - CENTER, 2));
      osc.frequency.setValueAtTime(50 + (dist * 20), audioCtxRef.current.currentTime);
      gain.gain.setValueAtTime(0, audioCtxRef.current.currentTime);
      gain.gain.linearRampToValueAtTime(0.04, audioCtxRef.current.currentTime + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtxRef.current.currentTime + 1.2);
      osc.connect(gain);
      gain.connect(audioCtxRef.current.destination);
      osc.start();
      osc.stop(audioCtxRef.current.currentTime + 1.5);
    }
  };

  const handleNodeClick = (id) => {
    const node = nodes[id];
    if (id === 'root') {
      setActiveId('root');
      setClickableIds(new Set(nodes['root'].next));
      setRevealedIds(new Set(['root']));
      playNodeEffect(nodes['root']);
      return;
    }
    if (clickableIds.has(id)) {
      setActiveId(id);
      setRevealedIds(prev => new Set(prev).add(id));
      setClickableIds(new Set(node.next));
      playNodeEffect(node);
    }
  };

  return (
    <div className="min-h-screen bg-[#060a08] text-[#8c1c40] font-sans selection:bg-[#4CAF50] selection:text-white flex flex-col overflow-hidden">
      <header className="p-2 md:p-5 flex justify-between items-center gap-2 border-b border-[#1b3022] bg-[#08100d] z-20 shadow-2xl">
        <div className="flex flex-col min-w-0 flex-1">
          <h1 className="text-[10px] md:text-lg font-bold tracking-[0.1em] md:tracking-[0.3em] uppercase text-[#4a9460]">
            Faixas de Rodagem do Pensamento
          </h1>
          {/*<span className="text-[16px] opacity-80 italic">Terhi Marttila — 2026</span>*/}
          <div className="flex items-center gap-2 mt-1">
            {/*  —  remove a text that says "rede de consciência colectiva because wow what a stupid crappy thing to add!*/}
             {/*<span className="text-[10px] opacity-40 italic uppercase tracking-[0.1em]">Rede de Consciência Coletiva</span>*/}
             {isAutoplay && <span className="text-[9px] bg-[#4a9460]/20 text-[#4a9460] px-2 py-0.5 rounded animate-pulse font-bold tracking-tighter">MODO AUTOPLAY</span>}
          </div>
        </div>
        
        <div className="flex gap-1 md:gap-3 flex-shrink-0">
          <button 
            onClick={() => setIsAutoplay(!isAutoplay)} 
            className={`p-2 md:p-3 rounded-full transition-all flex items-center gap-2 ${isAutoplay ? 'text-[#4CAF50] bg-[#112115] shadow-[0_0_15px_rgba(74,148,96,0.3)]' : 'text-gray-400 bg-black/40 hover:text-white'}`}
            title={isAutoplay ? "Pausar Autoplay" : "Iniciar Autoplay"}
          >
            {isAutoplay ? <Pause size={16} className="md:w-5 md:h-5" fill="currentColor" /> : <Play size={16} className="md:w-5 md:h-5" fill="currentColor" />}
          </button>

          <button 
            onClick={() => handleNodeClick('root')} 
            className="p-2 md:p-3 bg-black/40 hover:bg-[#1b3022] rounded-full text-[#4a9460] transition-colors"
            title="Reiniciar"
          >
            <RotateCcw size={16} className="md:w-5 md:h-5" />
          </button>

          <button onClick={() => setAudioEnabled(!audioEnabled)} className={`p-2 md:p-3 rounded-full transition-all ${audioEnabled ? 'text-[#4CAF50] bg-[#112115]' : 'text-gray-600 bg-black'}`}>
            {audioEnabled ? <Volume2 size={16} className="md:w-6 md:h-6" /> : <VolumeX size={16} className="md:w-6 md:h-6" />}
          </button>
          
          <button onClick={() => setShowInfo(true)} className="p-2 md:p-3 hover:bg-[#1b3022] rounded-full text-[#4a9460] transition-colors">
            <Info size={16} className="md:w-6 md:h-6" />
          </button>
        </div>
      </header>

      <main ref={mainContainerRef} className="flex-1 overflow-auto bg-[radial-gradient(circle_at_center,_#0a1410_0%,_#060a08_100%)] flex items-center justify-center p-4 md:p-12 pb-24">
        <div 
          className={`grid border-t border-l border-[#1b3022]/40 shadow-2xl bg-black/30 backdrop-blur-sm transition-opacity duration-1000 ${isAutoplay ? 'opacity-90' : 'opacity-100'}`}
          style={{ 
            gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(60px, 1fr))`,
            width: 'min(98vw, 1100px)',
            aspectRatio: '1/1'
          }}
        >
          {grid.map((row, y) => (
            row.map((nodeId, x) => {
              const node = nodeId ? nodes[nodeId] : null;
              const isRoot = nodeId === 'root';
              const isRevealed = revealedIds.has(nodeId);
              const isClickable = clickableIds.has(nodeId);
              const isActive = activeId === nodeId;

              let cellClasses = "border-b border-r border-[#1b3022]/30 flex items-center justify-center transition-all duration-500 relative text-center ";
              let content = null;

              if (nodeId) {
                if (isActive) {
                  cellClasses += "bg-[#112115] z-10 scale-110 shadow-[0_0_40px_rgba(76,175,80,0.4)] text-[#4CAF50] font-black";
                  content = node.text;
                } else if (isClickable) {
                  cellClasses += "cursor-pointer hover:bg-[#1a3022]/60 text-[#8c1c40] font-semibold";
                  content = <span className={`scale-105 inline-block ${isAutoplay ? 'opacity-60' : 'animate-pulse'}`}>{node.text}</span>;
                } else if (isRevealed || isRoot) {
                  cellClasses += "opacity-40 text-[#8c1c40] cursor-pointer hover:opacity-100 font-medium";
                  content = node.text;
                }
              }

              return (
                <div key={`${x}-${y}`} className={cellClasses} onClick={() => !isAutoplay && nodeId && handleNodeClick(nodeId)}>
                  {content && (
                    <span className={`leading-tight px-1 select-none transition-all ${isActive ? 'text-sm md:text-xl' : 'text-xs md:text-base'}`}>
                      {content}
                    </span>
                  )}
                  {isClickable && clickableIds.size > 1 && (
                    <div className="absolute top-0 right-0 w-2 h-2 bg-[#4CAF50] rounded-full m-1 shadow-[0_0_8px_#4CAF50]" />
                  )}
                </div>
              );
            })
          ))}
        </div>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 p-3 md:p-5 bg-[#08100d] border-t border-[#1b3022] flex justify-between items-center text-base tracking-[0.05em] md:tracking-[0.1em] uppercase opacity-100 z-10">
               <span>Clique nas palavras cintilantes para navegar. Clique no "eu" a qualquer momento para recomeçar.</span>

          {/* the following footers added unnecesary information about the UI/feedback on what is happening so they were taken out. */}
        {/*<div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 bg-[#4CAF50] rounded-full shadow-[0_0_10px_#4CAF50] ${isAutoplay ? 'animate-bounce' : 'animate-pulse'}`} />
          <span>{isAutoplay ? "Performance Generativa em curso..." : (clickableIds.size > 1 ? "Encruzilhada detetada: explore as conexões" : "Siga o trilho da voz")}</span>
        </div>

        <div className="flex gap-4 items-center">
            {isAutoplay && <span className="hidden sm:inline text-[#4a9460] font-bold">Modo Escuta Ativo</span>}
            <span className="hidden md:inline">Clique no "eu" para reset</span>
        </div>
        */}

      </footer>

      

      {showInfo && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-lg flex items-center justify-center p-4 md:p-6 z-50 overflow-y-auto">
          <div className="bg-[#0a1410] border border-[#1b3022] p-6 md:p-10 max-w-2xl w-full shadow-2xl relative my-auto">
            <h2 className="text-[#4CAF50] text-lg md:text-2xl font-bold mb-4 md:mb-6 tracking-widest uppercase border-b border-[#1b3022] pb-2">Sobre a Obra</h2>
            <div className="text-sm md:text-base space-y-3 md:space-y-5 text-[#f23a99] leading-relaxed">
                           <p>
                A escrita performativa em voz parte sempre do “eu”, seguindo a tradição feminista da autoficção e da escrita confessional. Da “eu” segue-se sempre “uma vez”. A partir daquele momento, o pensamento segue o trilho menos viscoso no cérebro de estrangeiro até encontrar a faixa mais provável de rodagem do pensamento.
              </p>
              <p>
                A interface permite navegar os fragmentos conforme interesse do leitor-ouvinte. Ao clicar numa escolha, ouve-se a voz e aparecem trilhos possíveis, clicáveis em ordens multilineares. É sempre possível voltar ao “eu” para recomeçar a leitura.
              </p>
              <p>O <strong>Modo Autoplay</strong> transforma esta rede numa sistema performativo autónomo.</p>

              <p>Ao ativar o play, a aplicação navega sozinha pelas faixas de rodagem. Sempre que encontra uma bifurcação (uma palavra comum a vários pensamentos), o sistema escolhe um caminho ao acaso, criando uma composição única e infinita.</p>
              <p className="pt-3 md:pt-4 border-t border-[#1b3022] text-[10px] md:text-[12px] opacity-100">
                Desenvolvido para Balleteatro - residências artísticas online - Março 2026<br/>
                Performance: Terhi Marttila <br/>           
                Sonoplastia: Diogo Cocharro <br/>           
                Código: Gemini3, Claude Sonnet 4.5 e Terhi Marttila

              </p>
            </div>
            <button onClick={() => setShowInfo(false)} className="mt-6 md:mt-10 w-full py-3 md:py-4 border border-[#4CAF50] text-[#4CAF50] hover:bg-[#4CAF50] hover:text-black transition-all font-bold uppercase text-xs tracking-[0.2em] md:tracking-[0.3em]">
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}