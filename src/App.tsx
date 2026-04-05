/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Camera, Sparkles, RefreshCw, Download, Image as ImageIcon, Settings2, X, Play, Film, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function App() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [transformedImage, setTransformedImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [showFormatMenu, setShowFormatMenu] = useState(false);
  const [isVideoProcessing, setIsVideoProcessing] = useState(false);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (isCameraActive) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isCameraActive]);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } 
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      setError(null);
    } catch (err) {
      console.error("Error accessing camera:", err);
      setError("No se pudo acceder a la cámara. Por favor, asegúrate de dar los permisos necesarios.");
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const captureFrame = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setCapturedImage(dataUrl);
        setIsCameraActive(false);
      }
    }
  };

  const transformImage = async () => {
    if (!capturedImage || !prompt.trim()) return;

    setIsProcessing(true);
    setError(null);

    try {
      const base64Data = capturedImage.split(',')[1];
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: 'image/jpeg',
              },
            },
            {
              text: `Modifica esta imagen según el siguiente pedido: ${prompt}. Mantén la composición general pero aplica los cambios artísticos o estructurales solicitados.`,
            },
          ],
        },
      });

      let foundImage = false;
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          setTransformedImage(`data:image/png;base64,${part.inlineData.data}`);
          foundImage = true;
          break;
        }
      }

      if (!foundImage) {
        setError("La IA no devolvió una imagen. Intenta con un prompt diferente.");
      }
    } catch (err) {
      console.error("AI Transformation error:", err);
      setError("Error al transformar la imagen. Por favor, intenta de nuevo.");
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    checkApiKey();
  }, []);

  const checkApiKey = async () => {
    if (window.aistudio) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      setHasApiKey(hasKey);
    }
  };

  const handleOpenSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  const generateVideo = async () => {
    if (!transformedImage && !capturedImage) return;
    
    if (!hasApiKey) {
      await handleOpenSelectKey();
    }

    setIsVideoProcessing(true);
    setError(null);
    setGeneratedVideoUrl(null);

    try {
      const activeImage = transformedImage || capturedImage;
      if (!activeImage) return;
      
      const base64Data = activeImage.split(',')[1];
      const mimeType = activeImage.split(';')[0].split(':')[1];

      const videoAi = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      let operation = await videoAi.models.generateVideos({
        model: 'veo-3.1-lite-generate-preview',
        prompt: prompt || 'Dales movimiento natural y cinematográfico a los elementos de esta imagen.',
        image: {
          imageBytes: base64Data,
          mimeType: mimeType,
        },
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });

      // Poll for completion
      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await videoAi.operations.getVideosOperation({ operation: operation });
      }

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (downloadLink) {
        const response = await fetch(downloadLink, {
          method: 'GET',
          headers: {
            'x-goog-api-key': process.env.GEMINI_API_KEY || '',
          },
        });
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setGeneratedVideoUrl(url);
      } else {
        setError("No se pudo generar el video. Intenta de nuevo.");
      }
    } catch (err: any) {
      console.error("Video Generation error:", err);
      const errorMsg = typeof err === 'string' ? err : JSON.stringify(err);
      
      if (errorMsg.includes("Requested entity was not found") || 
          errorMsg.includes("permission") || 
          errorMsg.includes("403") || 
          errorMsg.includes("PERMISSION_DENIED")) {
        setHasApiKey(false);
        setError("La generación de video requiere una API Key de un proyecto con facturación habilitada (Paid Plan).");
      } else {
        setError("Error al generar el movimiento. Asegúrate de tener una API Key válida configurada.");
      }
    } finally {
      setIsVideoProcessing(false);
    }
  };

  const downloadVideo = () => {
    if (generatedVideoUrl) {
      const link = document.createElement('a');
      link.href = generatedVideoUrl;
      link.download = `vision-ai-motion-${Date.now()}.mp4`;
      link.click();
    }
  };

  const reset = () => {
    setCapturedImage(null);
    setTransformedImage(null);
    setGeneratedVideoUrl(null);
    setIsCameraActive(true);
    setPrompt('');
  };

  const downloadImage = () => {
    if (transformedImage && canvasRef.current) {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current!;
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const mimeType = `image/${downloadFormat}`;
          const dataUrl = canvas.toDataURL(mimeType, 0.9);
          const link = document.createElement('a');
          link.href = dataUrl;
          link.download = `vision-ai-${Date.now()}.${downloadFormat}`;
          link.click();
        }
      };
      img.src = transformedImage;
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans selection:bg-indigo-500/30">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 bg-neutral-950/80 backdrop-blur-md border-b border-white/10 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">VisionAI <span className="text-indigo-400">Morph</span></h1>
        </div>
        <button 
          onClick={() => setIsCameraActive(!isCameraActive)}
          className={`p-2 rounded-full transition-colors ${isCameraActive ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-white/5 text-white hover:bg-white/10'}`}
        >
          {isCameraActive ? <X className="w-5 h-5" /> : <Settings2 className="w-5 h-5" />}
        </button>
      </header>

      <main className="pt-24 pb-32 px-4 max-w-4xl mx-auto">
        <div className="relative aspect-video bg-neutral-900 rounded-3xl overflow-hidden border border-white/5 shadow-2xl">
          <AnimatePresence mode="wait">
            {isCameraActive && !capturedImage && (
              <motion.div 
                key="camera"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0"
              >
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-8 left-0 right-0 flex justify-center">
                  <button 
                    onClick={captureFrame}
                    className="w-16 h-16 bg-white rounded-full border-4 border-white/20 flex items-center justify-center hover:scale-110 transition-transform active:scale-95 group"
                  >
                    <div className="w-12 h-12 bg-white rounded-full group-hover:bg-indigo-50 transition-colors" />
                  </button>
                </div>
              </motion.div>
            )}

            {capturedImage && !transformedImage && (
              <motion.div 
                key="captured"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0"
              >
                <img 
                  src={capturedImage} 
                  alt="Captured" 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <div className="text-center p-6 max-w-md">
                    <h2 className="text-2xl font-bold mb-4">¿Qué quieres transformar?</h2>
                    <div className="relative">
                      <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Ej: Conviérteme en un dibujo animado, ponme en Marte, estilo cyberpunk..."
                        className="w-full bg-neutral-800/90 border border-white/10 rounded-2xl p-4 text-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[100px] resize-none"
                      />
                      <button
                        onClick={transformImage}
                        disabled={isProcessing || !prompt.trim()}
                        className="mt-4 w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white font-semibold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2"
                      >
                        {isProcessing ? (
                          <RefreshCw className="w-5 h-5 animate-spin" />
                        ) : (
                          <Sparkles className="w-5 h-5" />
                        )}
                        {isProcessing ? 'Procesando...' : 'Transformar'}
                      </button>
                      <button
                        onClick={reset}
                        className="mt-2 w-full text-sm text-neutral-400 hover:text-white transition-colors"
                      >
                        Cancelar y volver a la cámara
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {(transformedImage || generatedVideoUrl) && (
              <motion.div 
                key="result"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 flex flex-col"
              >
                {generatedVideoUrl ? (
                  <video 
                    src={generatedVideoUrl} 
                    autoPlay 
                    loop 
                    controls 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <img 
                    src={transformedImage!} 
                    alt="Transformed" 
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                )}
                
                <div className="absolute bottom-6 left-0 right-0 flex flex-col items-center gap-3 px-6">
                  <div className="flex flex-wrap gap-2 w-full max-w-md">
                    <button
                      onClick={reset}
                      className="flex-1 min-w-[120px] bg-white/10 backdrop-blur-md hover:bg-white/20 text-white font-semibold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 border border-white/10"
                    >
                      <Camera className="w-5 h-5" />
                      Nueva
                    </button>
                    
                    {!generatedVideoUrl && (
                      <button
                        onClick={generateVideo}
                        disabled={isVideoProcessing}
                        className="flex-1 min-w-[120px] bg-indigo-600/20 backdrop-blur-md hover:bg-indigo-600/30 text-indigo-400 font-semibold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 border border-indigo-500/30"
                      >
                        {isVideoProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Film className="w-5 h-5" />}
                        {isVideoProcessing ? 'Generando...' : 'Dar Movimiento'}
                      </button>
                    )}

                    <div className="relative flex-1 min-w-[160px]">
                      <button
                        onClick={generatedVideoUrl ? downloadVideo : downloadImage}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-6 rounded-l-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 border-r border-indigo-400/30"
                      >
                        <Download className="w-5 h-5" />
                        {generatedVideoUrl ? 'Bajar Video' : `Guardar .${downloadFormat}`}
                      </button>
                      {!generatedVideoUrl && (
                        <button
                          onClick={() => setShowFormatMenu(!showFormatMenu)}
                          className="absolute right-[-40px] top-0 bottom-0 w-10 bg-indigo-700 hover:bg-indigo-600 text-white rounded-r-xl border-l border-indigo-400/30 flex items-center justify-center"
                        >
                          <Settings2 className="w-4 h-4" />
                        </button>
                      )}

                      <AnimatePresence>
                        {showFormatMenu && (
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="absolute bottom-full mb-2 right-[-40px] bg-neutral-900 border border-white/10 rounded-xl overflow-hidden shadow-2xl min-w-[120px]"
                          >
                            {(['png', 'jpeg', 'webp'] as const).map((fmt) => (
                              <button
                                key={fmt}
                                onClick={() => {
                                  setDownloadFormat(fmt);
                                  setShowFormatMenu(false);
                                }}
                                className={`w-full text-left px-4 py-3 text-sm hover:bg-white/5 transition-colors ${downloadFormat === fmt ? 'text-indigo-400 bg-indigo-500/5' : 'text-white'}`}
                              >
                                Formato .{fmt.toUpperCase()}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error Message */}
          {error && (
            <div className="absolute top-4 left-4 right-4 bg-red-500/90 backdrop-blur-md text-white p-4 rounded-xl text-sm flex flex-col gap-3 border border-red-400/20 z-[60]">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                <span className="flex-1">{error}</span>
                <button onClick={() => setError(null)} className="p-1 hover:bg-white/10 rounded">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {error.includes("facturación") && (
                <div className="flex gap-2">
                  <button 
                    onClick={handleOpenSelectKey}
                    className="bg-white text-red-600 px-3 py-1.5 rounded-lg font-bold text-xs hover:bg-neutral-100 transition-colors"
                  >
                    Seleccionar API Key
                  </button>
                  <a 
                    href="https://ai.google.dev/gemini-api/docs/billing" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="bg-red-600 text-white px-3 py-1.5 rounded-lg font-bold text-xs hover:bg-red-700 transition-colors border border-white/20"
                  >
                    Ver Documentación de Facturación
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Initial State */}
          {!isCameraActive && !capturedImage && !transformedImage && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center mb-6">
                <Camera className="w-10 h-10 text-indigo-400" />
              </div>
              <h2 className="text-3xl font-bold mb-2">Listo para la magia?</h2>
              <p className="text-neutral-400 mb-8 max-w-xs">Usa tu cámara para capturar un momento y deja que la IA lo transforme por completo.</p>
              <button
                onClick={() => setIsCameraActive(true)}
                className="bg-white text-neutral-950 font-bold py-4 px-10 rounded-2xl hover:scale-105 transition-transform active:scale-95"
              >
                Empezar Cámara
              </button>
            </div>
          )}
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
          <FeatureCard 
            icon={<Sparkles className="w-6 h-6 text-indigo-400" />}
            title="IA Generativa"
            description="Utiliza Gemini 2.5 Flash para rediseñar tus fotos con precisión."
          />
          <FeatureCard 
            icon={<ImageIcon className="w-6 h-6 text-indigo-400" />}
            title="Cualquier Estilo"
            description="Desde anime hasta realismo fotográfico, tú pones el límite."
          />
          <FeatureCard 
            icon={<Download className="w-6 h-6 text-indigo-400" />}
            title="Descarga Instantánea"
            description="Guarda tus creaciones directamente en tu dispositivo."
          />
        </div>
      </main>

      {/* Hidden Canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />
      
      {/* Footer */}
      <footer className="fixed bottom-0 w-full bg-neutral-950/80 backdrop-blur-md border-t border-white/5 py-4 px-6 text-center text-neutral-500 text-sm">
        Potenciado por Google Gemini • VisionAI Morph 2026
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="p-6 bg-white/5 rounded-3xl border border-white/5 hover:border-white/10 transition-colors">
      <div className="mb-4">{icon}</div>
      <h3 className="font-bold mb-2">{title}</h3>
      <p className="text-sm text-neutral-400 leading-relaxed">{description}</p>
    </div>
  );
}
