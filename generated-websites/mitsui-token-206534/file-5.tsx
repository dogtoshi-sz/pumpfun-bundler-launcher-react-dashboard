"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Copy, Check, ExternalLink } from "lucide-react"
import { useState } from "react"

export function TokenInfo() {
  const [copied, setCopied] = useState(false)
  const contractAddress = "TBD"

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(contractAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="py-20 px-4 bg-muted/30">
      <div className="container mx-auto max-w-4xl">
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Token Information
            </span>
          </h2>
        </div>

        <Card className="p-8 bg-card border-border">
          <div className="space-y-8">
            {/* Token Details */}
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Token Name</div>
                <div className="text-2xl font-semibold">Mitsui 光</div>
              </div>
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Symbol</div>
                <div className="text-2xl font-mono font-semibold">$光</div>
              </div>
            </div>

            {/* Contract Address */}
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">Contract Address</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 px-4 py-3 bg-muted rounded-lg font-mono text-sm break-all">
                  {contractAddress}
                </div>
                <Button size="icon" variant="outline" onClick={copyToClipboard} className="shrink-0 bg-transparent">
                  {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Social Links */}
            <div className="space-y-4 pt-4">
              <div className="text-sm text-muted-foreground">Official Links</div>
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" className="rounded-full bg-transparent" asChild>
                  <a href="https://mitsuiai.xyz" target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Website
                  </a>
                </Button>
                <Button variant="outline" className="rounded-full bg-transparent" asChild>
                  <a href="https://twitter.com" target="_blank" rel="noopener noreferrer">
                    <svg className="h-4 w-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                    Twitter
                  </a>
                </Button>
                <Button variant="outline" className="rounded-full bg-transparent" asChild>
                  <a href="https://telegram.org" target="_blank" rel="noopener noreferrer">
                    <svg className="h-4 w-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
                    </svg>
                    Telegram
                  </a>
                </Button>
              </div>
            </div>

            {/* CTA */}
            <div className="pt-4">
              <Button
                size="lg"
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-full"
                asChild
              >
                <a href="https://pump.fun" target="_blank" rel="noopener noreferrer">
                  Buy $光 on Pump.fun
                  <ExternalLink className="ml-2 h-5 w-5" />
                </a>
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </section>
  )
}
