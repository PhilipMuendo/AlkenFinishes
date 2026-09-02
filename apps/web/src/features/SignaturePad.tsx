import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Tabs } from '@/components/ui/tabs';

/**
 * Type-or-draw signature capture, shared by the public contract-signing page
 * (`pages/public/SignContract.tsx`) and the authenticated countersign dialog
 * (`pages/admin/Contracts.tsx`) — the two places in this app someone
 * actually signs something. Consent copy and submit buttons stay with the
 * caller; this is just the capture surface.
 *
 * Exposes an imperative `getSignature()` rather than pushing every
 * keystroke/stroke up as controlled state, so a canvas redraw never forces
 * the parent to re-render — the payload is only ever read once, at submit.
 */

export interface SignaturePayload {
  signerName: string;
  signatureMethod: 'TYPED' | 'DRAWN';
  signatureImage?: string;
}

export interface SignaturePadHandle {
  /** Null when not ready — no name, or a DRAWN method with nothing drawn. */
  getSignature(): SignaturePayload | null;
}

export const SignaturePad = forwardRef<
  SignaturePadHandle,
  { nameLabel?: string; onReadyChange?: (ready: boolean) => void }
>(({ nameLabel = 'Your full name', onReadyChange }, ref) => {
  const [method, setMethod] = useState<'TYPED' | 'DRAWN'>('TYPED');
  const [name, setName] = useState('');
  const canvas = useCanvasSignature();

  const ready = name.trim().length > 0 && (method === 'TYPED' || !canvas.isEmpty);
  useEffect(() => {
    onReadyChange?.(ready);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useImperativeHandle(ref, () => ({
    getSignature() {
      const signerName = name.trim();
      if (!signerName) return null;
      if (method === 'DRAWN') {
        if (canvas.isEmpty) return null;
        return { signerName, signatureMethod: 'DRAWN', signatureImage: canvas.toDataUrl() };
      }
      return { signerName, signatureMethod: 'TYPED' };
    },
  }));

  return (
    <div>
      <Tabs
        tabs={[
          { id: 'TYPED', label: 'Type your name' },
          { id: 'DRAWN', label: 'Draw your signature' },
        ]}
        active={method}
        onChange={(id) => setMethod(id as 'TYPED' | 'DRAWN')}
      />
      <div className="space-y-2 pt-4">
        <Field label={nameLabel}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Wanjiru"
            autoFocus
          />
        </Field>
        {method === 'TYPED' ? (
          name.trim() && (
            <p
              className="border-b border-hairline-strong pb-2 text-3xl text-fg"
              style={{ fontFamily: 'cursive' }}
            >
              {name}
            </p>
          )
        ) : (
          <>
            <p className="text-xs text-fg-muted">Draw your signature below.</p>
            <div className="overflow-hidden rounded-lg border border-hairline-strong bg-white">
              <canvas
                ref={canvas.ref}
                className="h-40 w-full touch-none"
                onPointerDown={canvas.onPointerDown}
                onPointerMove={canvas.onPointerMove}
                onPointerUp={canvas.onPointerUp}
                onPointerLeave={canvas.onPointerUp}
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={canvas.clear}>
              Clear
            </Button>
          </>
        )}
      </div>
    </div>
  );
});
SignaturePad.displayName = 'SignaturePad';

/** A minimal pointer-driven signature pad, exported as a PNG data URL on demand. */
function useCanvasSignature() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const resize = () => {
      const rect = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#111827';
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    const ctx = ref.current?.getContext('2d');
    const { x, y } = point(e);
    ctx?.beginPath();
    ctx?.moveTo(x, y);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ref.current?.getContext('2d');
    const { x, y } = point(e);
    ctx?.lineTo(x, y);
    ctx?.stroke();
    setIsEmpty(false);
  };
  const onPointerUp = () => {
    drawing.current = false;
  };
  const clear = () => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    setIsEmpty(true);
  };
  const toDataUrl = () => ref.current?.toDataURL('image/png') ?? '';

  return { ref, onPointerDown, onPointerMove, onPointerUp, clear, toDataUrl, isEmpty };
}
