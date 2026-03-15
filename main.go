package main

import (
	"log"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	fileServer := http.FileServer(http.Dir("./public"))

	http.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.ServeFile(w, r, "./public/index.html")
			return
		}

		fileServer.ServeHTTP(w, r)
	}))

	log.Printf("Chemical reaction visualizer running at http://localhost:%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
