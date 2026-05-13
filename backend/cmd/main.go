package main

import (
	"log"

	"github.com/wxops/wxops-portal-v2/internal/config"
	"github.com/wxops/wxops-portal-v2/internal/server"
)

func main() {
	cfg := config.Load()

	srv, err := server.New(cfg)
	if err != nil {
		log.Fatalf("failed to initialise server: %v", err)
	}

	log.Printf("W'xOps Portal backend listening on :%s", cfg.Port)
	if err := srv.Run(); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
