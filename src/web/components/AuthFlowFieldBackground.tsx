import { useEffect, useRef } from "react";

interface AuthFlowFieldBackgroundProps {
  className?: string;
  colorDark?: string;
  colorLight?: string;
  trailOpacity?: number;
  particleCount?: number;
  speed?: number;
}

type ThemeName = "dark" | "light";

export function AuthFlowFieldBackground({
  className = "",
  colorDark = "#5eead4",
  colorLight = "#0f766e",
  trailOpacity = 0.1,
  particleCount = 180,
  speed = 0.55
}: AuthFlowFieldBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const context = canvas.getContext("2d");
    if (!context) return;
    const ctx = context;

    let width = 0;
    let height = 0;
    let animationFrameId = 0;
    let currentTheme: ThemeName = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    const mouse = { x: -1000, y: -1000 };
    const particles: Particle[] = [];

    class Particle {
      x = Math.random() * Math.max(width, 1);
      y = Math.random() * Math.max(height, 1);
      vx = 0;
      vy = 0;
      age = 0;
      life = Math.random() * 220 + 120;

      update() {
        const angle =
          Math.sin(this.x * 0.0065) * 1.8 +
          Math.cos(this.y * 0.0055) * 1.4 +
          Math.sin((this.x + this.y) * 0.0024);

        this.vx += Math.cos(angle * Math.PI) * 0.16 * speed;
        this.vy += Math.sin(angle * Math.PI) * 0.16 * speed;

        const dx = mouse.x - this.x;
        const dy = mouse.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const radius = 140;

        if (distance < radius) {
          const force = (radius - distance) / radius;
          this.vx -= dx * force * 0.02;
          this.vy -= dy * force * 0.02;
        }

        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.94;
        this.vy *= 0.94;
        this.age += 1;

        if (this.age > this.life) {
          this.reset();
        }

        if (this.x < -10) this.x = width + 10;
        if (this.x > width + 10) this.x = -10;
        if (this.y < -10) this.y = height + 10;
        if (this.y > height + 10) this.y = -10;
      }

      reset() {
        this.x = Math.random() * Math.max(width, 1);
        this.y = Math.random() * Math.max(height, 1);
        this.vx = 0;
        this.vy = 0;
        this.age = 0;
        this.life = Math.random() * 220 + 120;
      }

      draw() {
        const alpha = 1 - Math.abs((this.age / this.life) * 2 - 1);
        ctx.globalAlpha = Math.max(alpha * 0.6, 0.08);
        ctx.fillRect(this.x, this.y, 1.4, 1.4);
      }
    }

    const resize = () => {
      width = container.clientWidth;
      height = container.clientHeight;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      particles.length = 0;
      for (let index = 0; index < particleCount; index += 1) {
        particles.push(new Particle());
      }
    };

    const drawFrame = () => {
      const fadeColor =
        currentTheme === "light"
          ? `rgba(236, 244, 245, ${trailOpacity})`
          : `rgba(6, 16, 28, ${trailOpacity})`;

      ctx.globalAlpha = 1;
      ctx.fillStyle = fadeColor;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = currentTheme === "light" ? colorLight : colorDark;

      particles.forEach((particle) => {
        particle.update();
        particle.draw();
      });

      animationFrameId = window.requestAnimationFrame(drawFrame);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();

      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
        mouse.x = -1000;
        mouse.y = -1000;
        return;
      }

      mouse.x = event.clientX - rect.left;
      mouse.y = event.clientY - rect.top;
    };

    const resetPointer = () => {
      mouse.x = -1000;
      mouse.y = -1000;
    };

    const handleThemeChange = () => {
      currentTheme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    };

    const observer = new MutationObserver(handleThemeChange);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    resize();
    drawFrame();

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("blur", resetPointer);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("blur", resetPointer);
      observer.disconnect();
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [colorDark, colorLight, particleCount, speed, trailOpacity]);

  return (
    <div aria-hidden="true" className={`auth-flow-field ${className}`.trim()} ref={containerRef}>
      <canvas className="auth-flow-field__canvas" ref={canvasRef} />
    </div>
  );
}
