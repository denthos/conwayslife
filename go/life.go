package main

import (
	"github.com/gopherjs/gopherjs/js"
	"math/rand"
	"runtime"
)

var board *Board
var playing bool

func main() {
	length := js.Global.Get("lifeBoardLength")
	width := js.Global.Get("lifeBoardWidth")
	density := js.Global.Get("lifeBoardDensity")
	board = CreateBoard(length.Int(), width.Int(), func(x, y int) bool { return rand.Float64() <= density.Float() })
	js.Global.Set("lifeBoard", map[string]interface{}{
		"Tiles":    board.Tiles,
		"Step":     board.Step,
		"Play":     Play,
		"Pause":    Pause,
		"Draw":     Draw,
		"DrawGrid": DrawGrid,
		"PlayLoop": PlayLoop,
	})
}

// Play sets "playing" to true and begins the play loop
func Play() {
	playing = true
	PlayLoop()
}

// PlayLoop steps the board, updating tiles as they change
func PlayLoop() {
	if playing {
		board.Step()
		js.Global.Call("setTimeout", PlayLoop, 5)
	}
}

// Pause stops the life board from stepping automatically
func Pause() {
	playing = false
}

// Draw draws the board to the canvas with ID=BoardCanvas
func Draw() {
	DrawGrid()
	canvas := js.Global.Get("document").Call("getElementById", "BoardCanvas")
	if canvas != nil {
		context := canvas.Call("getContext", "2d")
		if context != nil {
			for i := 0; i < board.GetLength(); i++ {
				for j := 0; j < board.GetWidth(); j++ {
					if board.Tiles[i][j] {
						// fill tile
						FillTile(i, j)
					} else {
						// clear tile
						ClearTile(i, j)
					}
				}
			}
		}
	}
}

// DrawGrid draws the grid on the canvas that is filled with Draw
func DrawGrid() {
	canvas := js.Global.Get("canvas")
	if canvas != nil {
		context := canvas.Call("getContext", "2d")
		if context != nil {
			xoffset := canvas.Get("width").Int() / board.GetWidth()
			yoffset := canvas.Get("height").Int() / board.GetLength()
			for x := 0; x < board.GetWidth(); x++ {
				context.Call("moveTo", 0.5+float64(x*xoffset), 0)
				context.Call("lineTo", 0.5+float64(x*xoffset), board.GetLength()*yoffset)
			}
			for x := 0; x < board.GetLength(); x++ {
				context.Call("moveTo", 0, 0.5+float64(x*yoffset))
				context.Call("lineTo", board.GetWidth()*xoffset, 0.5+float64(x*yoffset))
			}
			context.Set("strokeStyle", "black")
			context.Call("stroke")
		}
	}
}

// ClearTile clears the specified tile on the canvas
func ClearTile(x, y int) {
	canvas := js.Global.Get("canvas")
	if canvas != nil {
		context := canvas.Call("getContext", "2d")
		if context != nil {
			xoffset := canvas.Get("width").Int() / board.GetWidth()
			yoffset := canvas.Get("height").Int() / board.GetLength()
			context.Set("fillStyle", "#ffffff")
			context.Call("fillRect", float64(x*xoffset)+0.5, float64(y*yoffset)+0.5, xoffset, yoffset)
		}
	}
}

// FillTile fills the specified tile on the canvas
func FillTile(x, y int) {
	canvas := js.Global.Get("canvas")
	if canvas != nil {
		context := canvas.Call("getContext", "2d")
		if context != nil {
			xoffset := canvas.Get("width").Int() / board.GetWidth()
			yoffset := canvas.Get("height").Int() / board.GetLength()
			context.Set("fillStyle", "#000000")
			context.Call("fillRect", float64(x*xoffset)+0.5, float64(y*yoffset)+0.5, xoffset, yoffset)
		}
	}
}

// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// ------------------------- Life Implementation ------------------------
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------

// A Board is a collection of Tiles and has a length and width
type Board struct {
	length int
	width  int
	Tiles  [][]bool
	next   [][]bool
}

// GetSize returns the total number of Tiles in a board
func (board *Board) GetSize() int {
	return board.length * board.width
}

// GetLength returns the length of the board
func (board *Board) GetLength() int {
	return board.length
}

// GetWidth returns the width of the board
func (board *Board) GetWidth() int {
	return board.width
}

// Get returns the tile at x,y. If the coordinates are outside
// the boundaries, they are wrapped
func (board *Board) Get(x, y int) bool {
	x += board.length
	x %= board.length
	y += board.width
	y %= board.width
	return board.Tiles[x][y]
}

// returns whether the tile at x,y will be alive next step
func (board *Board) stepTile(x, y int) bool {
	// Count the adjacent cells that are alive.
	alive := 0
	for i := -1; i <= 1; i++ {
		for j := -1; j <= 1; j++ {
			if (j != 0 || i != 0) && board.Get(x+i, y+j) {
				alive++
			}
		}
	}
	// Return next state according to the game rules:
	//   exactly 3 neighbors: on,
	//   exactly 2 neighbors: maintain current state,
	//   otherwise: off.
	if alive == 3 || (alive == 2 && board.Tiles[x][y]) {
		board.next[x][y] = true
	} else {
		board.next[x][y] = false
	}

	switch {
	case board.Tiles[x][y] && !board.next[x][y]:
		//clear tile
		ClearTile(x, y)
	case !board.Tiles[x][y] && board.next[x][y]:
		// fill tile
		FillTile(x, y)
	}
	return board.next[x][y]
}

// Step steps the board forward one step, applying the rules of the game to
// each tile
func (board *Board) Step() {
	numCPU := runtime.NumCPU()
	chunkSize := (board.length + numCPU - 1) / numCPU
	for i := 0; i < board.length; i += chunkSize {
		go func(x int) {
			for j := x; j < x+chunkSize; j++ {
				for k := 0; k < board.width; k++ {
					board.stepTile(j, k)
				}
			}
		}(i)
	}
	board.Tiles, board.next = board.next, board.Tiles
}

// CreateEmptyBoard constructs a Board of the specified length and width and
// uses the optional function to fill the function, otherwise fills randomly
func CreateEmptyBoard(length, width int) *Board {
	board := &Board{length, width, make([][]bool, length), make([][]bool, length)}
	for i := range board.Tiles {
		board.Tiles[i] = make([]bool, width)
		board.next[i] = make([]bool, width)
	}
	return board
}

// CreateBoard constructs a Board of the specified length and width and uses
// the passed function to determine if the tile at Tiles[x][y] should be
// initialized as Alive or Dead
func CreateBoard(length, width int, filler func(int, int) bool) *Board {
	board := CreateEmptyBoard(length, width)
	numCPU := runtime.NumCPU()
	chunkSize := (board.length + numCPU - 1) / numCPU
	for i := 0; i < board.length; i += chunkSize {
		go func(x int) {
			for j := x; j < x+chunkSize; j++ {
				for k := 0; k < board.width; k++ {
					board.Tiles[j][k] = filler(i, j)
				}
			}
		}(i)
	}
	return board
}
