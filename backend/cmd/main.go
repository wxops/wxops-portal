// Package main is the entry point for the WxOps Portal backend.
//
// @title           WxOps Portal API
// @version         1.0
// @description     Internal developer platform API — service catalog, Kubernetes cluster management, and OIDC authentication via Pinniped.
//
// @contact.name    Platform Team
// @contact.url     https://wxops.cloud
//
// @host            localhost:8080
// @BasePath        /
// @schemes         http https
//
// @securityDefinitions.apikey CookieAuth
// @in              cookie
// @name            wxops_session
// @description     Encrypted session cookie issued after OIDC login.
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
