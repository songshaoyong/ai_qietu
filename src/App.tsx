import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Image as ImageIcon, Download, Settings2, Trash2, CheckCircle2, RotateCcw, BoxSelect, ImageIcon as ImageSquare, Code, LayoutTemplate } from 'lucide-react';
import JSZip from 'jszip';
import { detectSprites, SpriteSlice } from './lib/imageProcessor';
import { cn } from './lib/utils';
import { GoogleGenAI } from "@google/genai";

export default function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [slices, setSlices] = useState<SpriteSlice[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  // Settings
  const [tolerance, setTolerance] = useState(15);
  const [minBlobSize, setMinBlobSize] = useState(20);
  const [padding, setPadding] = useState(2);
  const [bgInfo, setBgInfo] = useState<[number, number, number, number] | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Design-to-Code States
  const [designImageSrc, setDesignImageSrc] = useState<string | null>(null);
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const designInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      loadImage(file);
    }
  };

  const loadImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setImageSrc(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      loadImage(file);
    }
  };

  const processSpriteSheet = async () => {
    if (!imageSrc) return;
    setIsProcessing(true);
    
    try {
      // Small timeout to allow UI to update to loading state
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const { slices, bgRgba } = await detectSprites(imageSrc, {
        tolerance,
        minBlobSize,
        padding
      });
      
      setSlices(slices);
      setBgInfo(bgRgba);
    } catch (error) {
      console.error("Error processing image:", error);
      alert("处理图片时发生错误，请尝试其他图片。");
    } finally {
      setIsProcessing(false);
    }
  };

  // Re-process when settings change if we already have an image
  useEffect(() => {
    if (imageSrc) {
      // Use a timeout to debounce setting changes
      const timer = setTimeout(() => {
        processSpriteSheet();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [tolerance, minBlobSize, padding, imageSrc]);

  const resetAll = () => {
    setImageSrc(null);
    setSlices([]);
    setBgInfo(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadAllAsZip = async () => {
    if (slices.length === 0) return;
    
    const zip = new JSZip();
    
    slices.forEach((slice, idx) => {
      // Convert data URL to blob data for zip
      const dataUrlParts = slice.dataUrl.split(',');
      const byteString = atob(dataUrlParts[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      
      // Pad single digits for better sorting (e.g., sprite_01.png)
      const numStr = (idx + 1).toString().padStart(slices.length > 99 ? 3 : 2, '0');
      zip.file(`sprite_${numStr}.png`, ab);
    });

    try {
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sprites_extracted.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Failed to generate zip", e);
    }
  };

  const downloadSingle = (slice: SpriteSlice) => {
    const a = document.createElement('a');
    a.href = slice.dataUrl;
    a.download = `${slice.id}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDesignUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        setDesignImageSrc(evt.target?.result as string);
        setGeneratedHtml(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const generateCodeAndPreview = async () => {
    if (!designImageSrc) return;
    
    setIsGenerating(true);
    setGeneratedHtml(null);
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            alert("GEMINI_API_KEY is missing. Please configure it in your secrets.");
            setIsGenerating(false);
            return;
        }

        const ai = new GoogleGenAI({ apiKey });
        
        const contents: any[] = [];
        const prompt = `You are an expert UI developer. I want to recreate the uploaded Design Image (the first image) using HTML and Tailwind CSS.
I also provided a list of extracted sprites. Each sprite image is preceded by its ID (e.g., 'sprite_1').

Generate a single HTML file using Tailwind CSS via CDN (<script src="https://cdn.tailwindcss.com"></script>) to recreate the layout and visual appearance of the Design Image as accurately as possible.

Important Rules:
1. For any image elements, use the exact Sprite ID as the src attribute. For example: <img src="sprite_1" alt="icon" />. Do NOT invent image URLs. Only use the provided Sprite IDs.
2. You can also use inline styles for background images: style="background-image: url('sprite_1');".
3. Structure the HTML beautifully and ensure the layout mimics the design image.
4. Output ONLY valid HTML code. Do NOT wrap it in markdown blocks. Start directly with <!DOCTYPE html>.`;
        
        contents.push({ text: prompt });
        contents.push({
            inlineData: {
                data: designImageSrc.split(',')[1],
                mimeType: "image/png"
            }
        });
        
        slices.forEach(slice => {
            contents.push({ text: `Available Sprite ID: ${slice.id}` });
            contents.push({
                inlineData: {
                    data: slice.dataUrl.split(',')[1],
                    mimeType: "image/png"
                }
            });
        });
        
        // Truncate to max 50 sprites to prevent payload too large
        if (slices.length > 50) {
            console.warn("Too many slices, only sending the first 50.");
            contents.length = 2 + (50 * 2);
        }
        
        const response = await ai.models.generateContent({
             model: "gemini-3.1-pro-preview",
             contents: contents
        });
        
        let html = response.text || "";
        if (html.startsWith("```html")) html = html.substring(7);
        if (html.startsWith("```")) html = html.substring(3);
        if (html.endsWith("```")) html = html.substring(0, html.length - 3);
        html = html.trim();
        
        // Map sprite IDs to actual base64 data URLs
        slices.forEach(slice => {
           const regex = new RegExp(`src=["']${slice.id}["']`, 'g');
           html = html.replace(regex, `src="${slice.dataUrl}"`);
           
           const regexUrl = new RegExp(`url\\(['"]?${slice.id}['"]?\\)`, 'g');
           html = html.replace(regexUrl, `url('${slice.dataUrl}')`);
        });
        
        setGeneratedHtml(html);
        
    } catch (err) {
        console.error("Failed to generate code", err);
        alert("生成代码失败，请检查控制台获取详细信息。");
    } finally {
        setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-indigo-500/30">
      <div className="max-w-7xl mx-auto p-6 md:p-10 space-y-10">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between border-b border-white/10 pb-6 gap-6">
          <div>
            <h1 className="text-3xl md:text-5xl font-medium tracking-tight text-white mb-2 flex items-center gap-3">
              <BoxSelect className="w-8 h-8 text-indigo-400" />
              智能切图工具
            </h1>
            <p className="text-neutral-400 text-lg max-w-2xl">
              上传精灵图(Sprite Sheet)或UI切图拼接，自动识别子图像边缘并生成独立切图供下载。
            </p>
          </div>
          {slices.length > 0 && (
             <div className="flex gap-3">
                <button 
                  onClick={resetAll}
                  className="px-4 py-2 border border-white/10 hover:bg-white/5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  重新上传
                </button>
                <button 
                  onClick={downloadAllAsZip}
                  className="px-5 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-lg shadow-indigo-500/20"
                >
                  <Download className="w-4 h-4" />
                  打包下载全部 ({slices.length})
                </button>
             </div>
          )}
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column: Upload / Original Preview & Settings */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Upload Area */}
            {!imageSrc ? (
              <div 
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                  "border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-12 text-center transition-all duration-200 min-h-[400px]",
                  isDragging 
                    ? "border-indigo-500 bg-indigo-500/10 scale-[1.02]" 
                    : "border-white/20 hover:border-white/40 hover:bg-white/5"
                )}
              >
                 <div className="p-4 bg-white/5 rounded-full mb-4">
                    <UploadCloud className="w-10 h-10 text-neutral-400" />
                 </div>
                 <h3 className="text-xl font-medium text-white mb-2">拖拽图片到此处</h3>
                 <p className="text-neutral-500 text-sm mb-6 max-w-[250px]">
                    支持包含纯色背景的精灵图，工具会自动识别并抠出独立图案。
                 </p>
                 <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                 />
                 <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="px-6 py-2.5 bg-white text-black font-medium rounded-lg hover:bg-neutral-200 transition-colors"
                 >
                    选择图片
                 </button>
              </div>
            ) : (
               <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden shadow-2xl relative group">
                  <div className="absolute top-3 right-3 z-10 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                     <button onClick={resetAll} className="p-2 bg-red-500/80 hover:bg-red-500 text-white rounded-lg backdrop-blur-md transition-colors" title="删除图片">
                        <Trash2 className="w-4 h-4" />
                     </button>
                  </div>
                  
                  {/* Visualizer container */}
                  <div className="relative p-6 bg-neutral-900 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] overflow-hidden flex items-center justify-center min-h-[300px]">
                     <img 
                        src={imageSrc} 
                        alt="Original sprite sheet" 
                        className="max-w-full h-auto max-h-[500px] object-contain shadow-2xl render-pixelated relative z-0" 
                     />
                     {/* Overlay bounding boxes if available and scale is roughly matching (simplified for this UI so we just draw them relatively if possible. 
                         Actually, keeping it simple: just show original image and maybe overlay SVG boxes). Let's do SVG overlay.
                      */}
                      {slices.length > 0 && (
                        <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6">
                           <div className="relative inline-block max-w-full max-h-full">
                               <img src={imageSrc} className="opacity-0 max-w-full max-h-full" alt="spacer" />
                               <div className="absolute inset-0 z-10 w-full h-full">
                                  {/* Render logic for boxes would go here, requiring actual rendered dims. Skipping for simplicity and focusing on gallery. */}
                               </div>
                           </div>
                        </div>
                      )}
                  </div>
               </div>
            )}

            {/* Settings Panel */}
            <div className={cn(
              "bg-neutral-900 border border-white/10 p-6 rounded-xl space-y-6 transition-all duration-300",
              !imageSrc && "opacity-50 pointer-events-none grayscale"
            )}>
              <div className="flex items-center gap-2 text-white border-b border-white/10 pb-4">
                 <Settings2 className="w-5 h-5" />
                 <h2 className="text-lg font-medium">切图参数设置</h2>
              </div>
              
              <div className="space-y-5">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <label className="text-neutral-300">容差值 (Tolerance)</label>
                    <span className="text-indigo-400 font-mono">{tolerance}</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" max="100" 
                    value={tolerance} 
                    onChange={e => setTolerance(parseInt(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                  <p className="text-xs text-neutral-500 mt-1">控制忽略背景颜色的严格程度，增加可处理轻微渐变或噪点。</p>
                </div>

                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <label className="text-neutral-300">防噪点尺寸 (Min Size)</label>
                    <span className="text-indigo-400 font-mono">{minBlobSize}px</span>
                  </div>
                  <input 
                    type="range" 
                    min="1" max="100" 
                    value={minBlobSize} 
                    onChange={e => setMinBlobSize(parseInt(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                  <p className="text-xs text-neutral-500 mt-1">过滤掉小于此像素数的小杂点。</p>
                </div>

                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <label className="text-neutral-300">切图边距 (Padding)</label>
                    <span className="text-indigo-400 font-mono">{padding}px</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" max="20" 
                    value={padding} 
                    onChange={e => setPadding(parseInt(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                  <p className="text-xs text-neutral-500 mt-1">为每个生成的切图四周额外保留的空白像素。</p>
                </div>
              </div>

              {bgInfo && (
                <div className="pt-4 border-t border-white/10 flex items-center justify-between">
                    <span className="text-sm text-neutral-400">检测到的背景色:</span>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-6 h-6 rounded-md border border-white/20 shadow-inner"
                        style={{ backgroundColor: `rgba(${bgInfo.join(',')})` }}
                      ></div>
                      <span className="text-xs font-mono text-neutral-500">
                        rgba({bgInfo.join(', ')})
                      </span>
                    </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Results Gallery */}
          <div className="lg:col-span-7 bg-white/[0.02] border border-white/5 rounded-xl min-h-[500px] p-6">
            <div className="flex items-center justify-between mb-6">
               <h2 className="text-xl font-medium text-white flex items-center gap-2">
                 <ImageSquare className="w-5 h-5 text-neutral-400" />
                 生成结果
                 {slices.length > 0 && (
                   <span className="bg-indigo-500/20 text-indigo-400 text-xs px-2.5 py-1 rounded-full ml-2">
                     {slices.length} 个
                   </span>
                 )}
               </h2>
               
               {isProcessing && (
                 <div className="flex items-center gap-2 text-indigo-400 text-sm">
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    识别中...
                 </div>
               )}
            </div>

            {!imageSrc ? (
               <div className="h-[400px] flex flex-col items-center justify-center text-neutral-500 border-2 border-dashed border-white/5 rounded-lg max-w-xl mx-auto">
                  <ImageIcon className="w-12 h-12 mb-4 opacity-20" />
                  <p>请先在左侧上传图片</p>
               </div>
            ) : slices.length === 0 && !isProcessing ? (
               <div className="h-[400px] flex flex-col items-center justify-center text-neutral-400 bg-neutral-900/50 rounded-lg">
                  <p>未检测到有效的子切图。</p>
                  <p className="text-sm mt-2">请尝试调整左侧的容差值或保证图片有纯色背景。</p>
               </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 auto-rows-max">
                {slices.map((slice, idx) => (
                  <div 
                    key={idx} 
                    className="group bg-neutral-900 border border-white/10 rounded-lg overflow-hidden flex flex-col hover:border-indigo-500/50 transition-colors"
                  >
                     <div className="flex-1 p-4 flex items-center justify-center bg-neutral-800 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:16px_16px]">
                        <img 
                          src={slice.dataUrl} 
                          alt={`Sprite ${idx + 1}`} 
                          className="max-w-full max-h-32 object-contain render-pixelated group-hover:scale-110 transition-transform duration-300"
                        />
                     </div>
                     <div className="bg-black/50 p-2 flex items-center justify-between border-t border-white/10 backdrop-blur-sm">
                        <span className="text-xs font-mono text-neutral-400">
                          {slice.rect.w}x{slice.rect.h}
                        </span>
                        <button 
                          onClick={() => downloadSingle(slice)}
                          className="p-1.5 hover:bg-white/10 text-neutral-300 hover:text-white rounded transition-colors"
                          title="下载单张图"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                     </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>

        {/* AI Design to Code Section */}
        {slices.length > 0 && (
          <section className="border-t border-white/10 pt-10 pb-20">
            <div className="mb-6">
              <h2 className="text-2xl font-medium text-white flex items-center gap-2">
                <Code className="w-6 h-6 text-indigo-400" />
                AI 重构设计图 (Design to Code)
              </h2>
              <p className="text-neutral-400 mt-2">上传一张设计图，AI 将利用上面提取的切图，为您生成包含 Tailwind CSS 的网页代码。</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Left: Design Image Target */}
              <div className="bg-neutral-900 border border-white/10 rounded-xl p-6 flex flex-col">
                {slices.length > 50 && (
                  <div className="mb-6 text-amber-400 text-sm bg-amber-400/10 p-4 rounded-lg border border-amber-400/20 text-balance leading-relaxed">
                    您提取的切图数量较多 ({slices.length} 个)。为保证 AI 的理解能力和生成速度，重构时只会提供前 50 个切图。建议您通过增加上方的「防噪点尺寸 (Min Size)」过滤掉多余的杂点。
                  </div>
                )}
                
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-neutral-200">1. 上传设计图</h3>
                  {designImageSrc && (
                    <button 
                      onClick={() => { setDesignImageSrc(null); setGeneratedHtml(null); }}
                      className="text-sm text-red-400 hover:text-red-300 transition-colors"
                    >
                      移除并重新选择
                    </button>
                  )}
                </div>
                
                {!designImageSrc ? (
                  <div 
                    onClick={() => designInputRef.current?.click()}
                    className="flex-1 min-h-[300px] border-2 border-dashed border-white/20 hover:border-indigo-400/50 hover:bg-white/5 rounded-xl flex flex-col items-center justify-center cursor-pointer transition-colors"
                  >
                    <LayoutTemplate className="w-10 h-10 text-neutral-500 mb-4" />
                    <p className="text-neutral-400">点击上传设计图</p>
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      ref={designInputRef}
                      onChange={handleDesignUpload}
                    />
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col">
                    <div className="flex-1 bg-black/50 rounded-lg overflow-hidden flex items-center justify-center p-4 border border-white/5">
                      <img src={designImageSrc} alt="Design" className="max-w-full max-h-[400px] object-contain shadow-2xl" />
                    </div>
                    
                    <button 
                      onClick={generateCodeAndPreview}
                      disabled={isGenerating}
                      className="mt-6 w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
                    >
                      {isGenerating ? (
                        <>
                          <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          代码生成中 (可能需要几十秒)...
                        </>
                      ) : (
                        <>
                          <Code className="w-5 h-5" />
                          开始生成网页与预览
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Right: Code & Preview Generator */}
              <div className="bg-neutral-900 border border-white/10 rounded-xl p-6 flex flex-col">
                <h3 className="text-lg font-medium text-neutral-200 mb-4">2. 效果预览</h3>
                
                <div className="flex-1 bg-black border border-white/10 rounded-lg overflow-hidden relative group min-h-[300px]">
                  {!generatedHtml ? (
                     <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-600">
                        <LayoutTemplate className="w-12 h-12 mb-3 opacity-20" />
                        <p>等待生成...</p>
                     </div>
                  ) : (
                     <iframe 
                       title="Generated Preview"
                       srcDoc={generatedHtml}
                       className="w-full h-full min-h-[400px] border-0 bg-white"
                       sandbox="allow-scripts"
                     />
                  )}
                  
                  {generatedHtml && (
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => {
                          const blob = new Blob([generatedHtml], { type: 'text/html' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = 'generated_ui.html';
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="bg-neutral-800/90 hover:bg-neutral-700 text-white p-2 rounded shadow backdrop-blur-sm border border-white/10 text-xs flex items-center gap-1 transition-colors"
                      >
                        <Download className="w-3 h-3" /> 下载 HTML
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

