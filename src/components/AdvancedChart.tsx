import React, { useEffect, useRef, useState } from 'react';
import { 
  createChart, 
  ColorType, 
  LineStyle, 
  CrosshairMode, 
  PriceScaleMode,
  IPriceLine, 
  ISeriesApi, 
  CandlestickSeries, 
  LineSeries 
} from 'lightweight-charts';
import { subscribeToCandles, Timeframe } from '../core/candleEngine';
import { subscribeToPrices, DECIMAL_PLACES } from '../core/priceEngine';
import { 
  Trash2, 
  MousePointer, 
  GitCommit, 
  Layers, 
  TrendingUp, 
  TrendingDown, 
  Compass, 
  Minus,
  ArrowUpRight
} from 'lucide-react';

interface AdvancedChartProps {
  symbol: string;
  timeframe: string;
  indicators?: {
    ema: boolean;
    sma: boolean;
    rsi: boolean;
    macd: boolean;
    bb: boolean;
  };
  bid: number;
  ask: number;
}

interface Drawing {
  id: string;
  type: 'trend' | 'horizontal' | 'vertical' | 'rectangle' | 'long' | 'short' | 'riskreward';
  points: { time: number; price: number }[];
  tpPrice?: number;
  slPrice?: number;
  entryPrice?: number;
  color?: string;
}

// Helper calculation functions for indicators
function calculateSMA(candles: Array<{ time: any; close: number }>, period: number) {
  const result: Array<{ time: any; value: number }> = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) continue;
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += candles[i - j].close;
    }
    result.push({ time: candles[i].time, value: sum / period });
  }
  return result;
}

function calculateEMA(candles: Array<{ time: any; close: number }>, period: number) {
  const result: Array<{ time: any; value: number }> = [];
  if (candles.length < period) return result;
  
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
  }
  let prevEma = sum / period;
  result.push({ time: candles[period - 1].time, value: prevEma });

  for (let i = period; i < candles.length; i++) {
    const currentEma = candles[i].close * k + prevEma * (1 - k);
    result.push({ time: candles[i].time, value: currentEma });
    prevEma = currentEma;
  }
  return result;
}

export default function AdvancedChart({ symbol, timeframe, indicators, bid, ask }: AdvancedChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const smaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bidLineRef = useRef<IPriceLine | null>(null);
  const askLineRef = useRef<IPriceLine | null>(null);

  const isInitialLoadRef = useRef(true);
  const lastCandleCountRef = useRef(0);

  const [activePrices, setActivePrices] = useState({ bid: 0, ask: 0 });
  const [activeTool, setActiveTool] = useState<Drawing['type'] | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [tempDrawing, setTempDrawing] = useState<Drawing | null>(null);
  const [renderTrigger, setRenderTrigger] = useState(0);

  const [draggingHandle, setDraggingHandle] = useState<{
    drawingId: string;
    handleType: 'tp' | 'entry' | 'sl' | 'p1' | 'p2';
  } | null>(null);

  // Refs for event callbacks to avoid recreating chart on state changes
  const activeToolRef = useRef(activeTool);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  const tempDrawingRef = useRef(tempDrawing);
  useEffect(() => { tempDrawingRef.current = tempDrawing; }, [tempDrawing]);

  const drawingsRef = useRef(drawings);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);

  const symbolRef = useRef(symbol);
  useEffect(() => { symbolRef.current = symbol; }, [symbol]);

  // Persistence
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`atfunding_drawings_${symbol}`);
      if (saved) {
        setDrawings(JSON.parse(saved));
      } else {
        setDrawings([]);
      }
    } catch (e) {
      console.warn('Could not load drawings', e);
    }
  }, [symbol]);

  const saveDrawings = (updated: Drawing[]) => {
    setDrawings(updated);
    try {
      localStorage.setItem(`atfunding_drawings_${symbol}`, JSON.stringify(updated));
    } catch (e) {
      console.warn('Could not save drawings', e);
    }
  };

  // Drawing tools handler ref
  const handleChartClickRef = useRef<(time: number, price: number) => void>(() => {});

  // 1. Initialize Official TradingView Lightweight Chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const decimals = DECIMAL_PLACES[symbol] || 4;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#131722' }, // Official TradingView dark background
        textColor: '#d1d4dc',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          width: 1,
          color: '#758696',
          style: LineStyle.Dashed,
          labelBackgroundColor: '#2a2e39',
        },
        horzLine: {
          width: 1,
          color: '#758696',
          style: LineStyle.Dashed,
          labelBackgroundColor: '#2a2e39',
        },
      },
      rightPriceScale: {
        borderColor: '#2a2e39',
        visible: true,
        autoScale: true,
        mode: PriceScaleMode.Normal,
        scaleMargins: {
          top: 0.05,    // Tight 5% padding above highest visible candle
          bottom: 0.05, // Tight 5% padding below lowest visible candle
        },
        alignLabels: true,
      },
      timeScale: {
        borderColor: '#2a2e39',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 10,
        rightOffset: 12,
      },
      handleScroll: true,
      handleScale: true,
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight || 450,
    });

    chartRef.current = chart;

    // Real candlestick series with universal dynamic autoscale
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', // Official TradingView teal green
      downColor: '#ef5350', // Official TradingView red
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      priceFormat: {
        type: 'price',
        precision: decimals,
        minMove: 1 / Math.pow(10, decimals),
      },
      autoscaleInfoProvider: (original: () => any) => {
        const res = original();
        if (!res || !res.priceRange) return res;

        let { minValue, maxValue } = res.priceRange;

        // Prevent zero-range flatline
        if (minValue === maxValue) {
          const delta = Math.abs(minValue) * 0.005 || 0.0001;
          minValue -= delta;
          maxValue += delta;
        }

        const range = maxValue - minValue;
        const padding = range * 0.02; // Tight 2% dynamic padding to prevent zoomed-out view

        return {
          priceRange: {
            minValue: minValue - padding,
            maxValue: maxValue + padding,
          },
        };
      },
    });

    seriesRef.current = candlestickSeries;

    // Optional Indicator Series (excluded from scale calculation to prevent distortion)
    if (indicators?.ema) {
      const emaSeries = chart.addSeries(LineSeries, {
        color: '#2962ff',
        lineWidth: 2,
        title: 'EMA 20',
        autoscaleInfoProvider: () => null,
      });
      emaSeriesRef.current = emaSeries;
    }

    if (indicators?.sma) {
      const smaSeries = chart.addSeries(LineSeries, {
        color: '#ff6d00',
        lineWidth: 2,
        title: 'SMA 50',
        autoscaleInfoProvider: () => null,
      });
      smaSeriesRef.current = smaSeries;
    }

    // Subscribe to timescale changes to sync drawing overlay
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      setRenderTrigger(prev => prev + 1);
    });

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || !entries[0].contentRect) return;
      const { width, height } = entries[0].contentRect;
      try {
        chart.applyOptions({ width, height: height || 450 });
      } catch (e) {}
      setRenderTrigger(prev => prev + 1);
    });

    resizeObserver.observe(chartContainerRef.current);

    // Drawing Tool Clicks
    chart.subscribeClick((param) => {
      if (!param.point || !param.time || !seriesRef.current || !activeToolRef.current) return;
      const clickedTime = param.time as number;
      try {
        const clickedPrice = seriesRef.current.coordinateToPrice(param.point.y);
        if (clickedPrice === null) return;
        handleChartClickRef.current(clickedTime, clickedPrice);
      } catch (e) {}
    });

    // Crosshair hover for temporary drawing preview
    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || !seriesRef.current || !tempDrawingRef.current) return;
      const crosshairTime = param.time as number;
      try {
        const crosshairPrice = seriesRef.current.coordinateToPrice(param.point.y);
        if (crosshairPrice === null) return;

        setTempDrawing(prev => {
          if (!prev) return null;
          return {
            ...prev,
            points: [prev.points[0], { time: crosshairTime, price: crosshairPrice }]
          };
        });
      } catch (e) {}
    });

    isInitialLoadRef.current = true;
    lastCandleCountRef.current = 0;

    return () => {
      resizeObserver.disconnect();
      if (seriesRef.current) {
        if (bidLineRef.current) {
          try { seriesRef.current.removePriceLine(bidLineRef.current); } catch (e) {}
          bidLineRef.current = null;
        }
        if (askLineRef.current) {
          try { seriesRef.current.removePriceLine(askLineRef.current); } catch (e) {}
          askLineRef.current = null;
        }
      }
      seriesRef.current = null;
      emaSeriesRef.current = null;
      smaSeriesRef.current = null;
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch (e) {}
        chartRef.current = null;
      }
    };
  }, [symbol, timeframe, indicators?.ema, indicators?.sma]);

  // Drawing tools handler implementation
  const handleChartClick = (time: number, price: number) => {
    const tool = activeToolRef.current;
    const currentTemp = tempDrawingRef.current;
    const currentDrawings = drawingsRef.current;
    const currentSymbol = symbolRef.current;

    if (tool === 'horizontal') {
      const newD: Drawing = {
        id: Math.random().toString(),
        type: 'horizontal',
        points: [{ time, price }],
        color: '#2962ff',
      };
      saveDrawings([...currentDrawings, newD]);
      setActiveTool(null);
    } else if (tool === 'vertical') {
      const newD: Drawing = {
        id: Math.random().toString(),
        type: 'vertical',
        points: [{ time, price }],
        color: '#e91e63',
      };
      saveDrawings([...currentDrawings, newD]);
      setActiveTool(null);
    } else if (tool === 'trend' || tool === 'rectangle') {
      if (!currentTemp) {
        setTempDrawing({
          id: 'temp',
          type: tool,
          points: [{ time, price }, { time, price }],
          color: '#26a69a',
        });
      } else {
        const newD: Drawing = {
          id: Math.random().toString(),
          type: tool,
          points: [currentTemp.points[0], { time, price }],
          color: tool === 'trend' ? '#26a69a' : '#ff9800',
        };
        saveDrawings([...currentDrawings, newD]);
        setTempDrawing(null);
        setActiveTool(null);
      }
    } else if (tool === 'long' || tool === 'short' || tool === 'riskreward') {
      let tpDelta = 0;
      let slDelta = 0;

      if (currentSymbol.includes('JPY')) {
        tpDelta = 1.500;
        slDelta = 0.750;
      } else if (currentSymbol.includes('XAU')) {
        tpDelta = 40.00;
        slDelta = 20.00;
      } else if (currentSymbol.includes('BTC')) {
        tpDelta = 2500.00;
        slDelta = 1250.00;
      } else {
        tpDelta = 0.01000;
        slDelta = 0.00500;
      }

      const tpPrice = tool === 'short' ? price - tpDelta : price + tpDelta;
      const slPrice = tool === 'short' ? price + slDelta : price - slDelta;

      const newD: Drawing = {
        id: Math.random().toString(),
        type: tool,
        points: [{ time, price }],
        tpPrice,
        slPrice,
        entryPrice: price,
        color: '#26a69a',
      };
      saveDrawings([...currentDrawings, newD]);
      setActiveTool(null);
    }
  };

  // Keep ref updated
  useEffect(() => {
    handleChartClickRef.current = handleChartClick;
  });

  // 2. Bind Centralized Candle Feed with setData for history and update for live
  useEffect(() => {
    isInitialLoadRef.current = true;
    lastCandleCountRef.current = 0;

    const unsubscribeCandles = subscribeToCandles(symbol, timeframe, (candles) => {
      const series = seriesRef.current;
      if (!series || !chartRef.current) return;
      if (!candles || candles.length === 0) return;

      try {
        if (isInitialLoadRef.current) {
          // Full history load on initial view
          series.setData(candles as any);
          if (chartRef.current) {
            chartRef.current.timeScale().fitContent();
          }
          isInitialLoadRef.current = false;
        } else if (candles.length !== lastCandleCountRef.current) {
          // New candle block added
          series.setData(candles as any);
        } else {
          // Live active candle update
          const lastCandle = candles[candles.length - 1];
          series.update(lastCandle as any);
        }

        lastCandleCountRef.current = candles.length;

        // Update indicator series
        if (emaSeriesRef.current) {
          emaSeriesRef.current.setData(calculateEMA(candles, 20) as any);
        }
        if (smaSeriesRef.current) {
          smaSeriesRef.current.setData(calculateSMA(candles, 50) as any);
        }

        setRenderTrigger(prev => prev + 1);
      } catch (e) {
        // Safe catch if chart object was disposed
      }
    });

    return () => {
      unsubscribeCandles();
    };
  }, [symbol, timeframe]);

  // 3. Bind Centralized Real-time Bid & Ask Price Line Overlays
  useEffect(() => {
    const decimals = DECIMAL_PLACES[symbol] || 4;

    const unsubscribePrices = subscribeToPrices((prices) => {
      const series = seriesRef.current;
      if (!series || !chartRef.current) return;

      const livePrice = prices[symbol];
      if (!livePrice) return;

      setActivePrices({ bid: livePrice.bid, ask: livePrice.ask });

      try {
        // Bid Price Line
        if (bidLineRef.current) {
          try { series.removePriceLine(bidLineRef.current); } catch (e) {}
          bidLineRef.current = null;
        }
        bidLineRef.current = series.createPriceLine({
          price: livePrice.bid,
          color: '#26a69a',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `Bid: ${livePrice.bid.toFixed(decimals)}`,
        });

        // Ask Price Line
        if (askLineRef.current) {
          try { series.removePriceLine(askLineRef.current); } catch (e) {}
          askLineRef.current = null;
        }
        askLineRef.current = series.createPriceLine({
          price: livePrice.ask,
          color: '#ef5350',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `Ask: ${livePrice.ask.toFixed(decimals)}`,
        });
      } catch (e) {
        // Safe catch if series or priceLine disposed
      }
    });

    return () => {
      unsubscribePrices();
      if (seriesRef.current) {
        if (bidLineRef.current) {
          try { seriesRef.current.removePriceLine(bidLineRef.current); } catch (e) {}
          bidLineRef.current = null;
        }
        if (askLineRef.current) {
          try { seriesRef.current.removePriceLine(askLineRef.current); } catch (e) {}
          askLineRef.current = null;
        }
      }
    };
  }, [symbol]);

  // Dragging handles logic
  useEffect(() => {
    if (!draggingHandle) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!chartContainerRef.current || !seriesRef.current || !chartRef.current) return;

      const rect = chartContainerRef.current.getBoundingClientRect();
      const localY = e.clientY - rect.top;
      let clickedPrice: number | null = null;
      try {
        clickedPrice = seriesRef.current.coordinateToPrice(localY);
      } catch (err) {
        return;
      }
      if (clickedPrice === null) return;

      const { drawingId, handleType } = draggingHandle;

      const updated = drawings.map(d => {
        if (d.id !== drawingId) return d;
        
        const decimals = DECIMAL_PLACES[symbol] || 4;
        const price = Number(clickedPrice.toFixed(decimals));

        if (handleType === 'tp') {
          return { ...d, tpPrice: price };
        } else if (handleType === 'sl') {
          return { ...d, slPrice: price };
        } else if (handleType === 'entry') {
          const shift = price - (d.entryPrice || 0);
          return { 
            ...d, 
            entryPrice: price, 
            tpPrice: d.tpPrice !== undefined ? Number((d.tpPrice + shift).toFixed(decimals)) : undefined,
            slPrice: d.slPrice !== undefined ? Number((d.slPrice + shift).toFixed(decimals)) : undefined,
            points: [{ ...d.points[0], price }]
          };
        } else if (handleType === 'p1') {
          return { ...d, points: [ { ...d.points[0], price }, d.points[1] ] };
        } else if (handleType === 'p2') {
          return { ...d, points: [ d.points[0], { ...d.points[1], price } ] };
        }
        return d;
      });

      saveDrawings(updated);
    };

    const handleGlobalMouseUp = () => {
      setDraggingHandle(null);
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [draggingHandle, drawings, symbol]);

  const getCoords = (time: number, price: number) => {
    if (!chartRef.current || !seriesRef.current) return { x: 0, y: 0, visible: false };
    try {
      const x = chartRef.current.timeScale().timeToCoordinate(time as any);
      const y = seriesRef.current.priceToCoordinate(price);
      return {
        x: x ?? 0,
        y: y ?? 0,
        visible: x !== null && y !== null
      };
    } catch (e) {
      return { x: 0, y: 0, visible: false };
    }
  };

  const deleteDrawing = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    saveDrawings(drawings.filter(d => d.id !== id));
  };

  const clearAllDrawings = () => {
    saveDrawings([]);
    setTempDrawing(null);
  };

  const decimals = DECIMAL_PLACES[symbol] || 4;

  return (
    <div className="w-full h-full relative flex flex-row bg-[#131722] rounded-2xl overflow-hidden border border-[#2a2e39]">
      
      {/* 1. DRAWING TOOLBAR */}
      <div className="w-12 bg-[#1e222d] border-r border-[#2a2e39] flex flex-col items-center py-4 space-y-2 z-20">
        <button
          onClick={() => { setActiveTool(null); setTempDrawing(null); }}
          className={`p-2 rounded-lg transition-colors cursor-pointer ${!activeTool ? 'bg-[#2962ff] text-white' : 'text-[#787b86] hover:text-white hover:bg-white/5'}`}
          title="Select Cursor"
        >
          <MousePointer className="w-4 h-4" />
        </button>

        <div className="w-6 h-px bg-[#2a2e39] my-1" />

        {[
          { type: 'trend', label: 'Trend Line', icon: ArrowUpRight },
          { type: 'horizontal', label: 'Horizontal Line', icon: Minus },
          { type: 'vertical', label: 'Vertical Line', icon: GitCommit },
          { type: 'rectangle', label: 'Rectangle', icon: Layers },
          { type: 'long', label: 'Long Position', icon: TrendingUp },
          { type: 'short', label: 'Short Position', icon: TrendingDown },
          { type: 'riskreward', label: 'R:R Tool', icon: Compass },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.type}
              onClick={() => {
                setActiveTool(item.type as Drawing['type']);
                setTempDrawing(null);
              }}
              className={`p-2 rounded-lg transition-all relative group cursor-pointer ${
                activeTool === item.type 
                  ? 'bg-[#26a69a] text-white shadow-lg shadow-[#26a69a]/20' 
                  : 'text-[#787b86] hover:text-white hover:bg-white/5'
              }`}
              title={item.label}
            >
              <Icon className="w-4 h-4" />
              <span className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1e222d] border border-[#2a2e39] text-[10px] text-slate-100 px-2 py-1 rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-30">
                {item.label}
              </span>
            </button>
          );
        })}

        <div className="w-6 h-px bg-[#2a2e39] my-1" />

        <button
          onClick={clearAllDrawings}
          className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/10 cursor-pointer"
          title="Clear All Drawings"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* 2. CHART VIEWPORT */}
      <div className="flex-1 h-full relative flex flex-col min-w-0">
        {/* HUD Info strip */}
        <div className="px-4 py-2 bg-[#1e222d] border-b border-[#2a2e39] flex items-center justify-between text-xs z-10 font-sans">
          <div className="flex items-center space-x-3">
            <span className="font-bold text-[#d1d4dc] text-sm tracking-tight">{symbol}</span>
            <span className="px-1.5 py-0.5 bg-[#2962ff]/20 text-[#2962ff] rounded text-[10px] font-mono uppercase font-semibold">{timeframe}</span>
            {activeTool && (
              <span className="px-2 py-0.5 bg-[#26a69a]/20 text-[#26a69a] rounded text-[10px] animate-pulse">
                Placing: {activeTool.toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-4 font-mono">
            <div className="text-[#26a69a]">
              <span className="text-[#787b86] text-[10px] uppercase mr-1">Bid:</span>
              {activePrices.bid > 0 ? activePrices.bid.toFixed(decimals) : '-'}
            </div>
            <div className="text-[#ef5350]">
              <span className="text-[#787b86] text-[10px] uppercase mr-1">Ask:</span>
              {activePrices.ask > 0 ? activePrices.ask.toFixed(decimals) : '-'}
            </div>
          </div>
        </div>

        {/* Official TradingView Lightweight Charts Canvas */}
        <div className="flex-1 w-full relative min-h-0" style={{ height: '420px' }}>
          <div ref={chartContainerRef} className="absolute inset-0 w-full h-full" />
          
          {/* Overlay for user-placed drawings */}
          <svg 
            className="absolute inset-0 w-full h-full pointer-events-none z-10"
            style={{ width: '100%', height: '100%' }}
          >
            {tempDrawing && tempDrawing.points.length >= 2 && (() => {
              const p1 = getCoords(tempDrawing.points[0].time, tempDrawing.points[0].price);
              const p2 = getCoords(tempDrawing.points[1].time, tempDrawing.points[1].price);
              
              if (tempDrawing.type === 'trend') {
                return (
                  <line 
                    x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} 
                    stroke="#26a69a" strokeWidth="2" strokeDasharray="3,3"
                  />
                );
              } else if (tempDrawing.type === 'rectangle') {
                return (
                  <rect 
                    x={Math.min(p1.x, p2.x)} y={Math.min(p1.y, p2.y)} 
                    width={Math.abs(p2.x - p1.x)} height={Math.abs(p2.y - p1.y)}
                    fill="rgba(38, 166, 154, 0.08)" stroke="#ff9800" strokeWidth="1.5" strokeDasharray="2,2"
                  />
                );
              }
              return null;
            })()}

            {drawings.map((d) => {
              const id = d.id;
              
              if (d.type === 'horizontal') {
                const pt = d.points[0];
                const coords = getCoords(pt.time, pt.price);
                if (!chartContainerRef.current) return null;
                const width = chartContainerRef.current.clientWidth;

                return (
                  <g key={id}>
                    <line 
                      x1="0" y1={coords.y} x2={width} y2={coords.y} 
                      stroke={d.color || '#2962ff'} strokeWidth="1.5"
                    />
                    <foreignObject x={width - 150} y={coords.y - 22} width="120" height="20">
                      <div className="flex justify-between items-center bg-[#1e222d] border border-[#2a2e39] rounded px-1 text-[8px] font-mono text-[#d1d4dc]">
                        <span>Lvl: {pt.price.toFixed(decimals)}</span>
                        <button onClick={(e) => deleteDrawing(id, e)} className="text-rose-400 hover:text-rose-300 ml-1.5 pointer-events-auto cursor-pointer">
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </foreignObject>
                  </g>
                );
              }

              if (d.type === 'vertical') {
                const pt = d.points[0];
                const coords = getCoords(pt.time, pt.price);
                if (!chartContainerRef.current) return null;
                const height = chartContainerRef.current.clientHeight;

                return (
                  <g key={id}>
                    <line 
                      x1={coords.x} y1="0" x2={coords.x} y2={height} 
                      stroke={d.color || '#e91e63'} strokeWidth="1.5"
                    />
                    <foreignObject x={coords.x - 45} y="10" width="90" height="22">
                      <div className="flex justify-between items-center bg-[#1e222d] border border-[#2a2e39] rounded px-1.5 py-0.5 text-[8px] font-mono text-[#d1d4dc]">
                        <span>{new Date(pt.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <button onClick={(e) => deleteDrawing(id, e)} className="text-rose-400 hover:text-rose-300 ml-1.5 pointer-events-auto cursor-pointer">
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </foreignObject>
                  </g>
                );
              }

              if (d.type === 'trend') {
                if (d.points.length < 2) return null;
                const p1 = getCoords(d.points[0].time, d.points[0].price);
                const p2 = getCoords(d.points[1].time, d.points[1].price);

                return (
                  <g key={id}>
                    <line 
                      x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} 
                      stroke={d.color || '#26a69a'} strokeWidth="2"
                    />
                    <circle 
                      cx={p1.x} cy={p1.y} r="5" fill="#fff" stroke="#26a69a" strokeWidth="1.5"
                      className="pointer-events-auto cursor-ns-resize"
                      onMouseDown={() => setDraggingHandle({ drawingId: id, handleType: 'p1' })}
                    />
                    <circle 
                      cx={p2.x} cy={p2.y} r="5" fill="#fff" stroke="#26a69a" strokeWidth="1.5"
                      className="pointer-events-auto cursor-ns-resize"
                      onMouseDown={() => setDraggingHandle({ drawingId: id, handleType: 'p2' })}
                    />
                    <foreignObject x={(p1.x + p2.x)/2 - 12} y={(p1.y + p2.y)/2 - 18} width="24" height="18">
                      <button onClick={(e) => deleteDrawing(id, e)} className="bg-[#1e222d] border border-[#2a2e39] rounded p-0.5 text-rose-400 hover:text-rose-300 pointer-events-auto cursor-pointer">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </foreignObject>
                  </g>
                );
              }

              if (d.type === 'rectangle') {
                if (d.points.length < 2) return null;
                const p1 = getCoords(d.points[0].time, d.points[0].price);
                const p2 = getCoords(d.points[1].time, d.points[1].price);
                
                const rx = Math.min(p1.x, p2.x);
                const ry = Math.min(p1.y, p2.y);
                const rw = Math.abs(p2.x - p1.x);
                const rh = Math.abs(p2.y - p1.y);

                return (
                  <g key={id}>
                    <rect 
                      x={rx} y={ry} width={rw} height={rh}
                      fill="rgba(255, 152, 0, 0.05)" stroke={d.color || '#ff9800'} strokeWidth="1.5"
                    />
                    <circle 
                      cx={p1.x} cy={p1.y} r="5" fill="#fff" stroke="#ff9800" strokeWidth="1.5"
                      className="pointer-events-auto cursor-ns-resize"
                      onMouseDown={() => setDraggingHandle({ drawingId: id, handleType: 'p1' })}
                    />
                    <circle 
                      cx={p2.x} cy={p2.y} r="5" fill="#fff" stroke="#ff9800" strokeWidth="1.5"
                      className="pointer-events-auto cursor-ns-resize"
                      onMouseDown={() => setDraggingHandle({ drawingId: id, handleType: 'p2' })}
                    />
                    <foreignObject x={rx + rw/2 - 12} y={ry + rh/2 - 9} width="24" height="18">
                      <button onClick={(e) => deleteDrawing(id, e)} className="bg-[#1e222d] border border-[#2a2e39] rounded p-0.5 text-rose-400 hover:text-rose-300 pointer-events-auto cursor-pointer">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </foreignObject>
                  </g>
                );
              }

              if (d.type === 'long' || d.type === 'short' || d.type === 'riskreward') {
                const entryVal = d.entryPrice ?? d.points[0].price;
                const tpVal = d.tpPrice ?? entryVal;
                const slVal = d.slPrice ?? entryVal;

                const entry = getCoords(d.points[0].time, entryVal);
                const tp = getCoords(d.points[0].time, tpVal);
                const sl = getCoords(d.points[0].time, slVal);

                if (!chartContainerRef.current) return null;

                const startX = entry.x;
                const endX = startX + 180;
                const midX = (startX + endX) / 2;

                const targetDiff = Math.abs(tpVal - entryVal);
                const stopDiff = Math.abs(entryVal - slVal);
                const rrRatio = stopDiff > 0 ? Number((targetDiff / stopDiff).toFixed(2)) : 0;

                const isLong = d.type === 'long' || d.type === 'riskreward';

                return (
                  <g key={id}>
                    {/* Target (Profit) Shaded Box */}
                    <rect 
                      x={startX} 
                      y={isLong ? tp.y : entry.y} 
                      width={180} 
                      height={Math.abs(tp.y - entry.y)}
                      fill="rgba(38, 166, 154, 0.12)" 
                      stroke="#26a69a" 
                      strokeWidth="0.5"
                    />

                    {/* Stop (Loss) Shaded Box */}
                    <rect 
                      x={startX} 
                      y={isLong ? entry.y : sl.y} 
                      width={180} 
                      height={Math.abs(entry.y - sl.y)}
                      fill="rgba(239, 83, 80, 0.12)" 
                      stroke="#ef5350" 
                      strokeWidth="0.5"
                    />

                    {/* Draggable level handles */}
                    <circle 
                      cx={midX} cy={tp.y} r="6" fill="#26a69a" stroke="#fff" strokeWidth="1.5"
                      className="pointer-events-auto cursor-ns-resize drop-shadow"
                      onMouseDown={() => setDraggingHandle({ drawingId: id, handleType: 'tp' })}
                    />
                    
                    <circle 
                      cx={midX} cy={entry.y} r="6" fill="#2962ff" stroke="#fff" strokeWidth="1.5"
                      className="pointer-events-auto cursor-ns-resize drop-shadow"
                      onMouseDown={() => setDraggingHandle({ drawingId: id, handleType: 'entry' })}
                    />

                    <circle 
                      cx={midX} cy={sl.y} r="6" fill="#ef5350" stroke="#fff" strokeWidth="1.5"
                      className="pointer-events-auto cursor-ns-resize drop-shadow"
                      onMouseDown={() => setDraggingHandle({ drawingId: id, handleType: 'sl' })}
                    />

                    <foreignObject x={startX + 5} y={entry.y - 30} width="170" height="60">
                      <div className="bg-[#1e222d] border border-[#2a2e39] rounded-lg p-1.5 text-[8.5px] font-bold font-mono space-y-0.5 text-[#d1d4dc]">
                        <div className="flex justify-between">
                          <span className={isLong ? 'text-[#26a69a]' : 'text-[#ef5350]'}>{isLong ? 'LONG POSITION' : 'SHORT POSITION'}</span>
                          <button onClick={(e) => deleteDrawing(id, e)} className="text-rose-400 hover:text-rose-300 pointer-events-auto cursor-pointer">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="text-white">R:R Ratio: <span className="text-[#2962ff]">{rrRatio}</span></div>
                        <div className="text-[#787b86]">Target: {tpVal.toFixed(decimals)} | Stop: {slVal.toFixed(decimals)}</div>
                      </div>
                    </foreignObject>
                  </g>
                );
              }

              return null;
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

