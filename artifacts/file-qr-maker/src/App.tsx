import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useRequestUploadUrl, type UploadResult } from '@workspace/api-client-react';
import { AlertCircle, ArrowUpRight, Check, Clipboard, Download, File, FileArchive, FileImage, FileText, Link2, LoaderCircle, LockKeyhole, Plus, RefreshCw, ScanLine, ShieldCheck, Sparkles, UploadCloud, X } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

type FlowState = 'empty' | 'selected' | 'requesting' | 'uploading' | 'making-qr' | 'ready' | 'error';
type InputMode = 'file' | 'internet';

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function LogoMark() {
  return (
    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[hsl(var(--accent))] text-[hsl(var(--primary))] shadow-[3px_3px_0_hsl(var(--primary))]" aria-hidden="true">
      <span className="absolute left-[8px] top-[8px] h-[7px] w-[7px] rounded-[2px] border-2 border-current" />
      <span className="absolute right-[8px] top-[8px] h-[7px] w-[7px] rounded-[2px] border-2 border-current" />
      <span className="absolute bottom-[8px] left-[8px] h-[7px] w-[7px] rounded-[2px] border-2 border-current" />
      <span className="absolute bottom-[8px] right-[8px] h-[4px] w-[4px] rounded-[1px] bg-current" />
    </span>
  );
}

function FileGlyph({ type, large = false }: { type?: string; large?: boolean }) {
  const Icon = type?.startsWith('image/') ? FileImage : type === 'application/pdf' || type?.startsWith('text/') ? FileText : type?.includes('zip') || type?.includes('compressed') ? FileArchive : File;
  return <Icon className={large ? 'h-10 w-10' : 'h-4 w-4'} strokeWidth={1.7} />;
}

function UploadProgress({ state, progress }: { state: FlowState; progress: number }) {
  const requesting = state === 'requesting';
  const making = state === 'making-qr';
  const label = requesting ? 'Preparing a secure link' : making ? 'Drawing your QR code' : 'Uploading file';
  const value = requesting ? 9 : making ? 100 : progress;
  return (
    <div className="mt-5 animate-rise rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.62)] p-4" data-testid="status-upload-progress">
      <div className="flex items-center justify-between gap-4 text-xs font-semibold">
        <span className="flex items-center gap-2 text-[hsl(var(--foreground))]">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[hsl(var(--chart-4))]" />
          {label}
        </span>
        <span className="font-mono text-[hsl(var(--muted-foreground))]">{Math.round(value)}%</span>
      </div>
      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-[hsl(var(--border))]">
        <div className="upload-shimmer absolute inset-y-0 left-0 overflow-hidden rounded-full bg-[hsl(var(--chart-4))] transition-[width] duration-300" style={{ width: `${Math.max(4, value)}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Your file stays intact while it travels directly to storage.</p>
    </div>
  );
}

function Home() {
  const [inputMode, setInputMode] = useState<InputMode>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [internetUrl, setInternetUrl] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [qrData, setQrData] = useState('');
  const [servedUrl, setServedUrl] = useState('');
  const [result, setResult] = useState<UploadResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<FlowState>('empty');
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { mutateAsync: requestUpload } = useRequestUploadUrl();
  const requestUploadRef = useRef(requestUpload);
  requestUploadRef.current = requestUpload;

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  useEffect(() => {
    if (!servedUrl) {
      setQrData('');
      return;
    }
    let cancelled = false;
    setState('making-qr');
    QRCode.toDataURL(servedUrl, {
      width: 720,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0d2b33', light: '#f7f3e8' },
    }).then((data) => {
      if (!cancelled) {
        setQrData(data);
        setState('ready');
      }
    }).catch(() => {
      if (!cancelled) {
        setError('We made the link, but could not draw the QR code. Please try once more.');
        setState('error');
      }
    });
    return () => { cancelled = true; };
  }, [servedUrl]);

  const selectFile = useCallback((file?: File) => {
    if (!file) return;
    if (file.size === 0) {
      setError('That file is empty. Choose a file with some content and try again.');
      setState('error');
      return;
    }
    setError('');
    setCopied(false);
    setQrData('');
    setServedUrl('');
    setResult(null);
    setProgress(0);
    setSelectedFile(file);
    setState('selected');
  }, []);

  const useInternetImage = useCallback(async () => {
    const value = internetUrl.trim();
    if (!value) {
      setError('Paste an image link first.');
      setState('error');
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      setError('Please enter a complete image link starting with https://');
      setState('error');
      return;
    }

    setError('');
    setCopied(false);
    setSelectedFile(null);
    setResult(null);
    setProgress(0);
    setQrData('');
    setServedUrl(parsed.toString());
    setState('making-qr');
  }, [internetUrl]);

  const openImageSearch = useCallback(() => {
    setInputMode('internet');
    setError('');
    window.open('https://www.google.com/search?tbm=isch', '_blank', 'noopener,noreferrer');
  }, []);

  const onFileInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0]);
    event.target.value = '';
  }, [selectFile]);

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer.files?.[0]);
  }, [selectFile]);

  const uploadBytes = useCallback((uploadURL: string, file: File) => new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadURL);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('The storage upload did not complete.'));
    xhr.onerror = () => reject(new Error('The upload connection was interrupted.'));
    xhr.onabort = () => reject(new Error('The upload was cancelled.'));
    xhr.send(file);
  }), []);

  const createQr = useCallback(async () => {
    if (!selectedFile || state === 'requesting' || state === 'uploading' || state === 'making-qr') return;
    setError('');
    setCopied(false);
    setProgress(0);
    setState('requesting');
    try {
      const upload = await requestUploadRef.current({
        data: {
          name: selectedFile.name,
          size: selectedFile.size,
          contentType: selectedFile.type || 'application/octet-stream',
        },
      });
      setResult(upload);
      setState('uploading');
      await uploadBytes(upload.uploadURL, selectedFile);
      const path = upload.objectPath.startsWith('http') ? upload.objectPath : `${window.location.origin}/api/storage${upload.objectPath.startsWith('/') ? upload.objectPath : `/${upload.objectPath}`}`;
      setServedUrl(path);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Something went wrong while uploading. Please try again.');
      setState('error');
    }
  }, [selectedFile, state, uploadBytes]);

  const copyLink = useCallback(async () => {
    if (!servedUrl) return;
    try {
      await navigator.clipboard.writeText(servedUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setError('Copying is unavailable here. Select the link and copy it manually.');
    }
  }, [servedUrl]);

  const startOver = useCallback(() => {
    setInputMode('file');
    setSelectedFile(null);
    setInternetUrl('');
    setResult(null);
    setServedUrl('');
    setQrData('');
    setProgress(0);
    setError('');
    setCopied(false);
    setState('empty');
  }, []);

  const isBusy = state === 'requesting' || state === 'uploading' || state === 'making-qr';
  const fileMeta = useMemo(() => selectedFile ? `${formatBytes(selectedFile.size)} · ${selectedFile.type || 'File'}` : '', [selectedFile]);
  const resultName = result?.metadata.name || 'Internet image';
  const resultSize = result ? formatBytes(result.metadata.size) : 'Online image';

  return (
    <main className="noise min-h-[100dvh] overflow-hidden bg-[hsl(var(--background))]">
      <header className="mx-auto flex w-full max-w-[1240px] items-center justify-between px-5 py-5 sm:px-8 lg:px-10" data-testid="header-main">
        <div className="flex items-center gap-3">
          <LogoMark />
          <div>
            <div className="text-[15px] font-extrabold tracking-[-.03em] text-[hsl(var(--foreground))]">file<span className="text-[hsl(var(--chart-4))]">qr</span>maker</div>
            <div className="font-mono text-[9px] uppercase tracking-[.22em] text-[hsl(var(--muted-foreground))]">share in a scan</div>
          </div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] px-3 py-2 text-[11px] font-semibold text-[hsl(var(--muted-foreground))] sm:flex">
          <span className="h-2 w-2 rounded-full bg-[hsl(var(--chart-4))] shadow-[0_0_0_3px_hsl(var(--accent)/.25)]" />
          No account needed
        </div>
      </header>

      <div className="mx-auto max-w-[1240px] px-5 pb-16 pt-8 sm:px-8 lg:px-10 lg:pt-16">
        <section className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-16">
          <div className="animate-rise">
            <div className="mb-5 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[.18em] text-[hsl(var(--chart-4))]">
              <span className="h-px w-8 bg-[hsl(var(--chart-4))]" />
              Turn a file into a doorway
            </div>
            <h1 className="max-w-[720px] text-balance text-[clamp(2.75rem,7vw,6.25rem)] font-extrabold leading-[.94] tracking-[-.075em] text-[hsl(var(--foreground))]">
              One file.<br /><span className="text-[hsl(var(--chart-4))]">One link.</span><br />Ready to scan.
            </h1>
            <p className="mt-7 max-w-[540px] text-[16px] leading-7 text-[hsl(var(--muted-foreground))] sm:text-[18px]">
              Drop in an image, document, or anything else. We’ll give it a clean link and a QR code that opens on any device.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">
              <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[hsl(var(--chart-4))]" /> Direct-to-storage upload</span>
              <span className="flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-[hsl(var(--chart-4))]" /> No sign-up</span>
            </div>
          </div>

          <div className="relative animate-rise [animation-delay:100ms]">
            <div className="absolute -right-7 -top-8 hidden h-24 w-24 rounded-full border border-dashed border-[hsl(var(--chart-4)/.55)] sm:block" />
            <div className="relative rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-[var(--shadow-lg)]">
              <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-[hsl(var(--muted))] p-1">
                <button type="button" onClick={() => { startOver(); setInputMode('file'); }} className={`rounded-lg px-3 py-2 text-[11px] font-bold transition ${inputMode === 'file' ? 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`} data-testid="button-mode-file">Upload a file</button>
                <button type="button" onClick={() => { startOver(); openImageSearch(); }} className={`rounded-lg px-3 py-2 text-[11px] font-bold transition ${inputMode === 'internet' ? 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`} data-testid="button-mode-internet">Internet image <ArrowUpRight className="ml-1 inline h-3 w-3" /></button>
              </div>
              {inputMode === 'internet' ? (
                <div className="relative flex min-h-[305px] flex-col justify-center rounded-[17px] border-2 border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/.54)] px-6 py-10">
                  <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--primary))] text-[hsl(var(--accent))] shadow-[5px_5px_0_hsl(var(--chart-4)/.45)]"><Link2 className="h-6 w-6" /></div>
                  <div className="text-[16px] font-extrabold text-[hsl(var(--foreground))]">Paste an image link</div>
                  <div className="mt-1.5 text-[12px] leading-5 text-[hsl(var(--muted-foreground))]">Use the direct URL of any public image on the internet.</div>
                  <input value={internetUrl} onChange={(event) => { setInternetUrl(event.target.value); setError(''); }} placeholder="https://example.com/photo.jpg" type="url" className="mt-5 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-3 text-[12px] text-[hsl(var(--foreground))] outline-none transition placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--chart-4))] focus:ring-2 focus:ring-[hsl(var(--chart-4)/.2)]" data-testid="input-internet-image-url" />
                  <button type="button" onClick={useInternetImage} disabled={state === 'making-qr'} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 py-3 text-[12px] font-bold text-[hsl(var(--primary-foreground))] shadow-[3px_3px_0_hsl(var(--chart-4))] transition hover:-translate-y-0.5 disabled:opacity-50" data-testid="button-create-internet-qr"><ScanLine className="h-4 w-4" /> Create QR from image</button>
                  {state === 'error' && error && <div className="mt-3 flex items-start gap-2 rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.08)] p-3 text-[12px] leading-5 text-[hsl(var(--foreground))]" role="alert" data-testid="status-internet-error"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--destructive))]" />{error}</div>}
                </div>
              ) : (
              <>
              <div
                className={`relative flex min-h-[305px] flex-col items-center justify-center overflow-hidden rounded-[17px] border-2 border-dashed px-6 py-10 text-center transition-all duration-300 ${isDragging ? 'scale-[1.015] border-[hsl(var(--chart-4))] bg-[hsl(var(--accent)/.18)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--muted)/.54)]'} ${selectedFile ? 'min-h-[210px]' : ''}`}
                onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false); }}
                onDrop={onDrop}
                data-testid="dropzone-file"
              >
                <input ref={inputRef} type="file" className="hidden" onChange={onFileInput} data-testid="input-file-picker" />
                {selectedFile ? (
                  <>
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[hsl(var(--accent))] text-[hsl(var(--primary))] shadow-[4px_4px_0_hsl(var(--primary))]">
                      {selectedFile.type.startsWith('image/') && previewUrl ? <img src={previewUrl} alt="" className="h-full w-full rounded-2xl object-cover" data-testid="img-selected-preview" /> : <FileGlyph type={selectedFile.type} large />}
                    </div>
                    <div className="max-w-full truncate text-[15px] font-extrabold text-[hsl(var(--foreground))]" data-testid="text-selected-file">{selectedFile.name}</div>
                    <div className="mt-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]" data-testid="text-selected-file-meta">{fileMeta}</div>
                    <button type="button" onClick={startOver} disabled={isBusy} className="absolute right-3 top-3 rounded-full p-1.5 text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--card))] hover:text-[hsl(var(--foreground))] disabled:opacity-40" aria-label="Remove selected file" data-testid="button-remove-file"><X className="h-4 w-4" /></button>
                  </>
                ) : (
                  <>
                    <div className="relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[hsl(var(--primary))] text-[hsl(var(--accent))] shadow-[5px_5px_0_hsl(var(--chart-4)/.45)]">
                      <UploadCloud className="h-7 w-7" strokeWidth={1.6} />
                      <span className="absolute -right-2 -top-2 rounded-full bg-[hsl(var(--chart-4))] p-1.5 text-[hsl(var(--primary))]"><Plus className="h-3 w-3" /></span>
                    </div>
                    <div className="text-[16px] font-extrabold text-[hsl(var(--foreground))]">{isDragging ? 'Release to add your file' : 'Drop your file here'}</div>
                    <div className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">Any image, document, or file type</div>
                    <button type="button" onClick={() => inputRef.current?.click()} className="mt-6 rounded-xl bg-[hsl(var(--primary))] px-5 py-3 text-[12px] font-bold text-[hsl(var(--primary-foreground))] shadow-[3px_3px_0_hsl(var(--chart-4))] transition duration-200 hover:-translate-y-0.5 hover:shadow-[4px_5px_0_hsl(var(--chart-4))] active:translate-y-0 active:shadow-[1px_2px_0_hsl(var(--chart-4))]" data-testid="button-choose-file">Choose a file <span className="ml-1 opacity-60">↗</span></button>
                  </>
                )}
              </div>
              {selectedFile && !isBusy && state !== 'ready' && (
                <button type="button" onClick={createQr} className="mt-3 flex w-full items-center justify-center gap-2 rounded-[15px] bg-[hsl(var(--primary))] px-5 py-4 text-[13px] font-extrabold text-[hsl(var(--primary-foreground))] shadow-[4px_4px_0_hsl(var(--chart-4))] transition duration-200 hover:-translate-y-0.5 hover:shadow-[5px_6px_0_hsl(var(--chart-4))] active:translate-y-0 active:shadow-[1px_2px_0_hsl(var(--chart-4))]" data-testid="button-create-qr"><ScanLine className="h-4 w-4" /> Create my QR code</button>
              )}
              {isBusy && <UploadProgress state={state} progress={progress} />}
              {state === 'error' && error && (
                <div className="mt-3 flex items-start gap-3 rounded-2xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.08)] p-4 text-left" role="alert" data-testid="status-upload-error">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--destructive))]" />
                  <div className="min-w-0 flex-1 text-[12px] leading-5 text-[hsl(var(--foreground))]">{error}</div>
                  <button type="button" onClick={() => setError('')} className="rounded p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]" aria-label="Clear error" data-testid="button-clear-error"><X className="h-3.5 w-3.5" /></button>
                </div>
              )}
              </>
              )}
            </div>
            <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[.13em] text-[hsl(var(--muted-foreground))]">Files are uploaded securely · links are ready in seconds</p>
          </div>
        </section>

        {state === 'ready' && qrData && (result || servedUrl) && (
          <section className="animate-rise mt-14 grid gap-6 border-t border-[hsl(var(--border))] pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:gap-14" data-testid="section-qr-result">
            <div className="flex flex-col justify-center">
              <div className="mb-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-[hsl(var(--chart-4))]"><Check className="h-4 w-4" /> Your QR is ready</div>
              <h2 className="text-[clamp(2rem,4vw,3.6rem)] font-extrabold leading-[.98] tracking-[-.06em] text-[hsl(var(--foreground))]">Point, scan,<br /><span className="text-[hsl(var(--chart-4))]">open.</span></h2>
              <p className="mt-5 max-w-[430px] text-[14px] leading-6 text-[hsl(var(--muted-foreground))]">Anyone can scan this code with their phone camera. Your file opens at its link — no app or account required.</p>
              <div className="mt-7 flex max-w-[500px] items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 pl-3 shadow-[var(--shadow-sm)]">
                <Link2 className="h-4 w-4 shrink-0 text-[hsl(var(--chart-4))]" />
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]" data-testid="text-served-url">{servedUrl}</span>
                <button type="button" onClick={copyLink} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[hsl(var(--secondary))] px-3 py-2 text-[11px] font-bold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--accent))]" data-testid="button-copy-link">{copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy link'}</button>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <a href={qrData} download={`file-qr-${resultName}.png`} className="flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-[12px] font-extrabold text-[hsl(var(--primary-foreground))] shadow-[3px_3px_0_hsl(var(--chart-4))] transition hover:-translate-y-0.5" data-testid="link-download-qr"><Download className="h-4 w-4" /> Download QR</a>
                <button type="button" onClick={startOver} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-[12px] font-bold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))]" data-testid="button-start-over"><RefreshCw className="h-4 w-4" /> Start over</button>
              </div>
            </div>
            <div className="relative flex min-h-[330px] items-center justify-center overflow-hidden rounded-[26px] bg-[hsl(var(--primary))] p-8 shadow-[var(--shadow-lg)]">
              <div className="scan-grid absolute inset-0 opacity-[.09]" />
              <div className="absolute left-7 top-7 font-mono text-[9px] uppercase tracking-[.2em] text-[hsl(var(--primary-foreground)/.6)]">Scanlight / 01</div>
              <div className="relative rounded-[20px] bg-[hsl(var(--card))] p-4 shadow-[8px_8px_0_hsl(var(--chart-4)/.6)] sm:p-5">
                <img src={qrData} alt={`QR code for ${selectedFile?.name || 'uploaded file'}`} className="block aspect-square w-[min(58vw,270px)]" data-testid="img-qr-code" />
                <div className="mt-3 flex items-center justify-between gap-4 border-t border-[hsl(var(--border))] pt-3">
                  <span className="max-w-[190px] truncate text-[10px] font-bold text-[hsl(var(--foreground))]" data-testid="text-qr-file-name">{resultName}</span>
                  <span className="font-mono text-[9px] text-[hsl(var(--muted-foreground))]">{resultSize}</span>
                </div>
              </div>
              <div className="animate-scanline absolute left-5 right-5 top-1/2 h-px bg-[hsl(var(--accent)/.6)] shadow-[0_0_18px_hsl(var(--accent)/.55)]" />
            </div>
          </section>
        )}

        <section className="mt-20 grid gap-10 border-t border-[hsl(var(--border))] pt-9 sm:grid-cols-[1fr_1.4fr] lg:mt-24 lg:grid-cols-[.72fr_1.28fr]" data-testid="section-how-it-works">
          <div>
            <div className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[.18em] text-[hsl(var(--chart-4))]"><Sparkles className="h-3.5 w-3.5" /> The short version</div>
            <h2 className="mt-4 max-w-[280px] text-2xl font-extrabold leading-tight tracking-[-.045em] text-[hsl(var(--foreground))]">Scanning is just opening a link.</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { number: '01', title: 'Drop a file', body: 'Images, PDFs, decks, or any file you need to pass around.' },
              { number: '02', title: 'We make a link', body: 'Your file goes straight to secure storage. Nothing gets resized.' },
              { number: '03', title: 'Scan anywhere', body: 'Print the code, share it, or point a camera at your screen.' },
            ].map((item) => (
              <div key={item.number} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.64)] p-5 transition duration-200 hover:-translate-y-1 hover:bg-[hsl(var(--card))]" data-testid={`card-how-${item.number}`}>
                <div className="font-mono text-[11px] font-medium text-[hsl(var(--chart-4))]">{item.number}</div>
                <h3 className="mt-7 text-[14px] font-extrabold text-[hsl(var(--foreground))]">{item.title}</h3>
                <p className="mt-2 text-[12px] leading-5 text-[hsl(var(--muted-foreground))]">{item.body}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
      <footer className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border))] px-5 py-6 sm:px-8 lg:px-10">
        <span className="font-mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">Made for the moment you need to share</span>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[hsl(var(--muted-foreground))]"><ArrowUpRight className="h-3.5 w-3.5" /> Works on every camera</span>
      </footer>
    </main>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;