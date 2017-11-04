package main

import (
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/gin-gonic/gin"
	_ "github.com/heroku/x/hmetrics/onload"
)

func main() {
	port := os.Getenv("PORT")

	if port == "" {
		log.Fatal("$PORT must be set")
	}

	router := gin.Default()
	router.Use(gin.Logger())
	router.LoadHTMLGlob("templates/*.tmpl.html")
	router.Static("/static", "static")
	router.Static("/js", "js")

	router.GET("/", func(c *gin.Context) {
		lengthStr := c.DefaultQuery("length", "1000")
		widthStr := c.DefaultQuery("width", "1000")
		length, err := strconv.Atoi(lengthStr)
		if err != nil {
			length = 1000
		}
		width, err := strconv.Atoi(widthStr)
		if err != nil {
			width = 1000
		}
		c.HTML(http.StatusOK, "index.tmpl.html", gin.H{
			"length": length,
			"width":  width,
		})
	})

	router.Run(":" + port)
}
