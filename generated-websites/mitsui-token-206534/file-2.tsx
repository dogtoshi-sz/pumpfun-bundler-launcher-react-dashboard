import { Hero } from "@/components/hero"
import { About } from "@/components/about"
import { TokenInfo } from "@/components/token-info"
import { Footer } from "@/components/footer"

export default function Home() {
  return (
    <main className="min-h-screen">
      <Hero />
      <About />
      <TokenInfo />
      <Footer />
    </main>
  )
}
