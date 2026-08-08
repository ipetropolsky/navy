import { useEffect, useRef } from 'react';

import { createSeaRenderer } from '@/components/Sea/renderSea';

import styles from './Sea.module.less';

/** Максимальный шаг времени: после возврата на вкладку волны не прыгают вперёд. */
const MAX_FRAME_STEP = 0.1;

const MAX_PIXEL_RATIO = 2;

interface SeaProps {
    className?: string;
}

export default function Sea({ className }: SeaProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (!container || !canvas) {
            return undefined;
        }

        const renderer = createSeaRenderer(canvas);
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

        let time = 0;
        let lastFrame = 0;
        let frameId = 0;

        const applySize = () => {
            const { width, height } = container.getBoundingClientRect();
            renderer.resize(width, height, Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
            renderer.draw(time);
        };

        const renderFrame = (now: number) => {
            time += Math.min((now - lastFrame) / 1000, MAX_FRAME_STEP);
            lastFrame = now;
            renderer.draw(time);
            frameId = requestAnimationFrame(renderFrame);
        };

        const start = () => {
            cancelAnimationFrame(frameId);
            if (reducedMotion.matches) {
                renderer.draw(time);
                return;
            }
            lastFrame = performance.now();
            frameId = requestAnimationFrame(renderFrame);
        };

        applySize();
        start();

        const observer = new ResizeObserver(applySize);
        observer.observe(container);
        reducedMotion.addEventListener('change', start);

        return () => {
            cancelAnimationFrame(frameId);
            observer.disconnect();
            reducedMotion.removeEventListener('change', start);
        };
    }, []);

    return (
        <div ref={containerRef} className={[styles.sea, className].filter(Boolean).join(' ')}>
            <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label="Ночное море" />
        </div>
    );
}
