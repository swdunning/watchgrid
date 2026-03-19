// frontend/src/pages/Landing.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { api } from "../api/client";
import wgLogo from "../assets/watchgrid-logo.png"

// If you have a WatchGrid logo asset, import it here.
// Example:
// import wgLogo from "../assets/watchgrid-logo.png";

type ProviderMeta = {
  provider: string;
  label: string;
  logoUrl: string | null;
};

type LandingDemoRow = {
  key: string;
  title: string;
  items: Array<{
    title: string;
    poster: string | null;
    provider?: string | null;
    type?: string | null;
  }>;
};

type LandingDemoPayload = {
  rows: LandingDemoRow[];
  collagePosters: string[]; // poster URLs for backgrounds
};

function uniqBy<T>(arr: T[], keyFn: (t: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

/**
 * Teaching moment (React):
 * - useEffect runs after render; we use it to fetch data (providers + demo posters).
 * - useMemo caches a derived value so we don’t rebuild it every render.
 */
export default function LandingPage() {
  const nav = useNavigate();

  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);

  const [demo, setDemo] = useState<LandingDemoPayload | null>(null);
  const [demoLoading, setDemoLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const data = await api<{ providers: ProviderMeta[] }>("/api/meta/providers");
        if (!mounted) return;

        const cleaned = uniqBy(
          (data.providers || [])
            .map((p) => ({
              provider: String(p.provider || "").toUpperCase(),
              label: p.label || String(p.provider || "").toUpperCase(),
              logoUrl: p.logoUrl ?? null,
            }))
            .filter((p) => p.provider),
          (p) => p.provider
        );

        setProviders(cleaned);
      } catch {
        setProviders([]);
      } finally {
        if (mounted) setProvidersLoading(false);
      }
    })();

    (async () => {
      try {
        const data = await api<LandingDemoPayload>("/api/landing/demo");
        if (!mounted) return;
        setDemo(data);
      } catch {
        setDemo(null);
      } finally {
        if (mounted) setDemoLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const marqueeProviders = useMemo(() => {
    const base = providers.length ? providers : [];
    // Repeat so the marquee can loop without “dead space”.
    return [...base, ...base, ...base];
  }, [providers]);

  // Collage background posters (URLs). Used in section backgrounds.
  /*const collage = demo?.collagePosters ?? [];
   const collageStyle = useMemo(() => {
    // Use a few posters as layered background images.
    // Multiple background images work like: background-image: url(a), url(b), url(c)
    const picks = collage.slice(0, 10).filter(Boolean);
    if (!picks.length) return undefined;

    return {
      backgroundImage: picks.map((u) => `url(${u})`).join(", "),
    } as React.CSSProperties;
  }, [collage]); */

  // Pull the mock hero “WatchGrid screen” posters from demo rows.
  const heroRows = useMemo(() => {
    const rows = demo?.rows ?? [];
    const want = ["popular_netflix", "popular_hulu", "popular_prime"];
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return want
      .map((k) => byKey.get(k))
      .filter(Boolean) as LandingDemoRow[];
  }, [demo]);

  return (
    <>
      <Header
        right={
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn secondary" onClick={() => nav("/login")}>
              Sign in
            </button>
            <button className="btn" onClick={() => nav("/register")}>
              Create account
            </button>
          </div>
        }
      />

      <div className="wgLandingFull">
        {/* HERO (centered copy + logo + mock product) */}
        <section className="wgSection wgHeroSection">
          <div className="wgHeroBackdrop" aria-hidden="true" />

          <div className="wgHeroCenter">
            {/* Logo: swap this for your real logo */}
            <div className="wgHeroLogo">
              {/* If you have a logo file, use <img src={wgLogo} ... /> */}
              <img
				src={wgLogo}
				alt="WatchGrid"
				className="wgHeroLogoImg"
				/>
            </div>

            <div className="wgHeroKicker">All your streaming lists in one grid.</div>

            <h1 className="wgHeroTitle">
              Stop hunting across apps.
              <br />
              Build your watchlist once.
            </h1>

            <p className="wgHeroSub">
              Browse popular picks by service, save what looks good, and open any title instantly.
              WatchGrid keeps everything organized in one clean home screen.
            </p>

            <div className="wgHeroCtas">
						  <button className="btn" onClick={() => nav("/register")}>
                Get started free →
              </button>
              <button className="btn secondary" onClick={() => nav("/login")}>
                I already have an account
              </button>
            </div>
					  <div className="wgHeroTrust">
						  <span>✓ Free account</span>
						  <span>✓ No credit card</span>
						  <span>✓ Takes 10 seconds</span>
					  </div>

            {/* Mock WatchGrid screen */}
            <div className="wgHeroMock" aria-label="WatchGrid example">
              <div className="wgMockTopBar">
                <div className="wgMockDot" />
                <div className="wgMockDot" />
                <div className="wgMockDot" />
                <div className="wgMockPill">Your WatchGrid</div>
              </div>

              <div className="wgMockBody">
                {demoLoading ? (
                  <>
                    <MockRow title="Popular on Netflix" loading />
                    <MockRow title="Popular on Hulu" loading />
                    <MockRow title="Popular on Prime Video" loading />
                  </>
                ) : (
                  <>
                    <MockRow title="Popular on Netflix" posters={(heroRows[0]?.items ?? []).map((x) => x.poster)} />
                    <MockRow title="Popular on Hulu" posters={(heroRows[1]?.items ?? []).map((x) => x.poster)} />
                    <MockRow title="Popular on Prime Video" posters={(heroRows[2]?.items ?? []).map((x) => x.poster)} />
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

			  {/* BEFORE / AFTER PROBLEM-SOLUTION SECTION */}
			  <section className="wgSection wgCompareSection">
				  <div className="wgSectionInner">
					  <div className="wgCompareHeader">
						  <div className="wgSectionHeading">Stop juggling streaming apps</div>
						  <div className="wgSectionSub muted">
							  WatchGrid turns a scattered watchlist problem into one clean home screen.
						  </div>
					  </div>

					  <div className="wgCompareGrid">
						  <div className="wgCompareCard wgCompareBad">
							  <div className="wgCompareLabel">Before WatchGrid</div>
							  <div className="wgCompareTitle">Your watchlists are scattered everywhere</div>

							  <ul className="wgCompareList">
								  <li>You search the same titles over and over</li>
								  <li>You forget which service had what</li>
								  <li>You save things mentally, then lose track</li>
								  <li>You waste time opening app after app</li>
							  </ul>
						  </div>

						  <div className="wgCompareCard wgCompareGood">
							  <div className="wgCompareLabel">After WatchGrid</div>
							  <div className="wgCompareTitle">Everything lives in one organized grid</div>

							  <ul className="wgCompareList">
								  <li>Save titles by streaming service in one place</li>
								  <li>Browse popular picks and genres faster</li>
								  <li>Open titles instantly without re-searching</li>
								  <li>Always know what to watch next</li>
							  </ul>
						  </div>
					  </div>

					  <div className="wgCompareCtaRow">
						  <button className="btn" onClick={() => nav("/register")}>
							  Build my WatchGrid →
						  </button>
					  </div>
				  </div>
			  </section>

        {/* LOGO MARQUEE SECTION (big logos, no boxes, collage background) */}
        <section className="wgSection wgLogosSection">
          <div className="wgCollageWall" aria-hidden="true">
  {(demo?.collagePosters ?? []).slice(0, 72).map((src, i) => (
    <img key={`${src}-${i}`} src={src} alt="" loading="lazy" decoding="async" />
  ))}
</div>
          <div className="wgCollageOverlay" aria-hidden="true" />

          <div className="wgSectionInner">
            <div className="wgSectionHeading">
              Create lists from the streaming services you already subscribe to.
            </div>
            <div className="wgSectionSub muted">
              Pick your services, browse popular titles and genres, and save everything into one place.
            </div>

            <div className="wgLogoMarquee">
              <div className="wgMarqueeFadeLeft" aria-hidden="true" />
              <div className="wgMarqueeFadeRight" aria-hidden="true" />

              <div className="wgMarqueeTrackBig" aria-label="Supported streaming services">
                {(providersLoading ? Array.from({ length: 12 }) : marqueeProviders).map((p: any, idx) => {
                  if (providersLoading) return <div key={`sk-${idx}`} className="wgLogoSkelBig" />;

                  const label = p?.label ?? p?.provider ?? "Service";
                  const logoUrl = p?.logoUrl ?? null;

                  return (
                    <div key={`${p.provider}-${idx}`} className="wgLogoBig" title={label}>
                      {logoUrl ? <img src={logoUrl} alt={label} /> : <span>{label}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

			  {/* DEMO RAILS (Popular TV, Popular Movies, All My Lists) using TMDB-backed demo data */}
			  <section className="wgSection wgDemoSection">
				  <div className="wgDemoHeaderSection">
					  <div className="wgSectionHeading">
						  See your WatchGrid in action
					  </div>
					  <div className="wgSectionSub muted">
						  Your saved titles, plus popular picks — all in one place.
					  </div>
				  </div>
          <div className="wgSectionInner">
            <div className="wgDemoGrid">
              <DemoShowcase
                title="All My Lists"
                subtitle="A mixed feed of saved titles across services"
                items={demo?.rows?.find((r) => r.key === "all_my_lists")?.items ?? []}
              />
              <DemoShowcase
                title="Popular TV Shows"
                subtitle="A quick way to find something good tonight"
                items={demo?.rows?.find((r) => r.key === "popular_tv")?.items ?? []}
              />
              <DemoShowcase
                title="Popular Movies"
                subtitle="Scroll, save, and open instantly"
                items={demo?.rows?.find((r) => r.key === "popular_movies")?.items ?? []}
              />
            </div>

            <div className="wgFooterCta">
              <div>
                <div className="wgFooterTitle">Ready to clean up your watchlist?</div>
                <div className="muted">Create an account, choose your services, and start saving titles.</div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn" onClick={() => nav("/register")}>
                  Create account →
                </button>
                <button className="btn secondary" onClick={() => nav("/login")}>
                  Sign in
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

/**
 * Teaching moment:
 * - posters.map(...) loops over an array and returns JSX for each element.
 * - The variable name `p` (or `it`) is just “the current item in the loop”.
 */
function MockRow({
  title,
  posters,
  loading,
}: {
  title: string;
  posters?: Array<string | null | undefined>;
  loading?: boolean;
}) {
  const slots = Array.from({ length: 10 });

  return (
    <div className="wgMockRow">
      <div className="wgMockRowTitle">{title}</div>
      <div className="wgMockRail">
        {slots.map((_, i) => {
          const src = posters?.[i] ?? null;
          return src && !loading ? (
            <img key={i} className="wgMockPosterImg" src={src} alt="" loading="lazy" decoding="async" />
          ) : (
            <div key={i} className="wgMockPosterSkel" />
          );
        })}
      </div>
    </div>
  );
}

function DemoShowcase({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: Array<{ title: string; poster: string | null; provider?: string | null; type?: string | null }>;
}) {
  const posters = (items || []).slice(0, 10);

  return (
    <div className="wgDemoCard">
      <div className="wgDemoHeader">
        <div className="wgDemoTitle">{title}</div>
        <div className="wgDemoSub muted">{subtitle}</div>
      </div>

      <div className="wgDemoRail">
        {posters.map((it, i) => (
          <div key={`${it.title}-${i}`} className="wgDemoTile" title={it.title}>
            {it.poster ? <img src={it.poster} alt={it.title} loading="lazy" decoding="async" /> : <div className="wgDemoPosterSkel" />}
            <div className="wgDemoTileTitle">{it.title}</div>
            <div className="wgDemoTileMeta">
              {it.type ? it.type : ""}
              {it.provider ? ` • ${it.provider}` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}