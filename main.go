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
		lengthStr := c.DefaultQuery("length", "300")
		widthStr := c.DefaultQuery("width", "300")
		densityStr := c.DefaultQuery("density", "0.15")
		length, err := strconv.Atoi(lengthStr)
		if err != nil {
			length = 300
		}
		width, err := strconv.Atoi(widthStr)
		if err != nil {
			width = 300
		}
		density, err := strconv.ParseFloat(densityStr, 64)
		if err != nil {
			density = 0.15
		}
		c.HTML(http.StatusOK, "index.tmpl.html", gin.H{
			"length":  length,
			"width":   width,
			"density": density,
		})
	})

	router.Run(":" + port)
}
