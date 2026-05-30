package main

import (
	"log"
	"os"

	"github.com/wxops/wxops-portal-v2/internal/config"
	"github.com/wxops/wxops-portal-v2/internal/server"
)

func main() {
	// Prefix all stdlib log output with [backend] so container log streams are
	// distinguishable from [frontend] (Next.js) and [nginx] lines.
	log.SetOutput(os.Stdout)
	log.SetPrefix("[backend] ")
	log.SetFlags(log.Ldate | log.Ltime)

	cfg := config.Load()

	srv, err := server.New(cfg)
	if err != nil {
		log.Fatalf("init failed: %v", err)
	}

	log.Printf("listening on :%s", cfg.Port)
	if err := srv.Run(); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
