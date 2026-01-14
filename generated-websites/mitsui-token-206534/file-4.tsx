import { Card } from "@/components/ui/card"
import { Brain, Zap, TrendingUp } from "lucide-react"

export function About() {
  const features = [
    {
      icon: Brain,
      title: "AI-Powered",
      description: "Built on cutting-edge artificial intelligence technology",
    },
    {
      icon: Zap,
      title: "Lightning Fast",
      description: "Experience seamless and rapid transactions",
    },
    {
      icon: TrendingUp,
      title: "Growth Focused",
      description: "Join the revolution of intelligent investing",
    },
  ]

  return (
    <section id="about" className="py-20 px-4">
      <div className="container mx-auto max-w-6xl">
        {/* Heading */}
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl md:text-5xl font-bold text-balance">
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Revolutionary AI Innovation
            </span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Dive into the revolutionary world of Mitsui AI, where innovation meets intelligence. {"Don't"} miss out on
            the AI wave {"that's"} changing the game!
          </p>
        </div>

        {/* Feature Cards */}
        <div className="grid md:grid-cols-3 gap-6">
          {features.map((feature, index) => {
            const Icon = feature.icon
            return (
              <Card
                key={index}
                className="p-6 bg-card border-border hover:border-primary/50 transition-all duration-300 group"
              >
                <div className="space-y-4">
                  <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold">{feature.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
                </div>
              </Card>
            )
          })}
        </div>
      </div>
    </section>
  )
}
