# Conway's Game of Life for the MARS MIPS simulator
#
# A 32 x 32 world whose edges wrap around. Each cell stores its age: 0 is dead,
# and a live cell counts 1, 2, 3 ... up to 8 generations, getting brighter as it
# gets older.
#
# To run it in MARS, open Tools > Bitmap Display, set the unit width and height
# to 16, the display width and height to 512, the base address to 0x10000000
# (global data), and connect it to MIPS before pressing Run.
#
# This is a rewrite of FinalCombinedCode.asm, the 2016 class project. That
# version took about 193,000 instructions per generation; this one takes about
# 25,000. What changed:
#
#   * The grid has a one-cell border that holds copies of the opposite edges, so
#     the inner loop reads all eight neighbours at fixed offsets and never has
#     to test for an edge or divide.
#   * Neighbours are counted with a sliding window: moving one cell to the right
#     reuses two of the three column totals and only reads one new column.
#   * The two grids swap roles each generation instead of being copied.
#   * Only the pixels that changed are redrawn, all together at the end of the
#     generation, so the display never shows a half-finished frame.

# ---- Sizes (grid cells are words, so offsets are in bytes) -------------------
.eqv SIZE        32          # cells per side
.eqv WIDTH       34          # cells per row in memory: SIZE plus a border cell each side
.eqv ROW_BYTES   128         # SIZE * 4:  from the first real cell of a row to just past the last
.eqv STRIDE      136         # WIDTH * 4: from a cell to the one below it
.eqv FIRST_CELL  140         # STRIDE + 4: the first real cell, at row 1, column 1
.eqv GRID_BYTES  4624        # WIDTH * WIDTH * 4
.eqv LIST_BYTES  8192        # SIZE * SIZE entries of 8 bytes

# ---- Offsets from a cell to its neighbours -----------------------------------
.eqv UP_LEFT     -140
.eqv UP          -136
.eqv UP_RIGHT    -132
.eqv LEFT        -4
.eqv RIGHT       4
.eqv DOWN_LEFT   132
.eqv DOWN        136
.eqv DOWN_RIGHT  140

# ---- Offsets used to copy the edges into the border ---------------------------
.eqv LAST_COLUMN 128         # from a row's left border cell to its last real cell
.eqv RIGHT_PAD   132         # from a row's left border cell to its right border cell
.eqv LAST_ROW    4352        # 32 * STRIDE: from the top border row to the last real row
.eqv BOTTOM_PAD  4488        # 33 * STRIDE: from the top border row to the bottom border row

# ---- Other settings ----------------------------------------------------------
.eqv DISPLAY     0x10000000  # base address of the bitmap display
.eqv FIRST_AGE   1           # age given to a newborn cell
.eqv MAX_AGE     8           # ages stop counting here
.eqv ONE_IN      3           # a random field brings one cell in this many to life

.data
gridA:    .space GRID_BYTES
gridB:    .space GRID_BYTES
drawList: .space LIST_BYTES  # pixels to redraw this generation: (address, colour) pairs

# Colour for each age, 0 (dead) to 8 (oldest).
palette:  .word 0x000000, 0xb40000, 0xc50000, 0xdc0808, 0xf11919
          .word 0xff4949, 0xff6565, 0xff8181, 0xffb6b6

banner:   .asciiz "Conway's Game of Life, 32 x 32, edges wrap around.\n"

# Starting patterns: (row, column) pairs, ended by -1.
blinker:  .byte 1,2, 2,2, 3,2, -1

glider:   .byte 1,2
          .byte 2,3
          .byte 3,1, 3,2, 3,3, -1

acorn:    .byte 15,21
          .byte 16,23
          .byte 17,20, 17,21, 17,24, 17,25, 17,26, -1

bigBlinker:
          .byte 1,3, 1,4, 1,5, 1,6, 1,8, 1,9, 1,10, 1,11
          .byte 2,3, 2,6, 2,8, 2,11
          .byte 3,1, 3,2, 3,3, 3,6, 3,7, 3,8, 3,11, 3,12, 3,13
          .byte 4,1, 4,13
          .byte 5,1, 5,13
          .byte 6,1, 6,2, 6,3, 6,11, 6,12, 6,13
          .byte 7,3, 7,11
          .byte 8,1, 8,2, 8,3, 8,11, 8,12, 8,13
          .byte 9,1, 9,13
          .byte 10,1, 10,13
          .byte 11,1, 11,2, 11,3, 11,6, 11,7, 11,8, 11,11, 11,12, 11,13
          .byte 12,3, 12,6, 12,8, 12,11
          .byte 13,3, 13,4, 13,5, 13,6, 13,8, 13,9, 13,10, 13,11, -1

.text
# Registers that keep their meaning for the whole program:
#   $s0  current grid            $s4  3
#   $s1  next grid               $s5  4
#   $s2  palette                 $s6  MAX_AGE
#   $s3  bitmap display          $s7  draw list
main:
    li   $v0, 4                     # print string
    la   $a0, banner
    syscall

    la   $s0, gridA
    la   $s1, gridB
    la   $s2, palette
    li   $s3, DISPLAY
    li   $s4, 3
    li   $s5, 4
    li   $s6, MAX_AGE
    la   $s7, drawList

    j    startRandom                # <-- starting pattern: startRandom, startGlider,
                                    #     startBlinker, startBigBlinker or startAcorn

# ---- Starting patterns -------------------------------------------------------

# Bring roughly one cell in ONE_IN to life, at random.
startRandom:
    addi $t8, $s0, FIRST_CELL       # cell being filled
    li   $t9, SIZE                  # rows left
    li   $t0, FIRST_AGE
randomRow:
    addi $t7, $t8, ROW_BYTES        # where this row ends
randomCell:
    li   $v0, 42                    # random integer from 0 to $a1 - 1, returned in $a0
    li   $a0, 0                     # random number generator 0
    li   $a1, ONE_IN
    syscall
    bnez $a0, randomNext
    sw   $t0, 0($t8)
randomNext:
    addi $t8, $t8, 4
    bne  $t8, $t7, randomCell
    addi $t8, $t8, 8                # step over the two border cells
    addi $t9, $t9, -1
    bnez $t9, randomRow
    j    begin

startBlinker:
    la   $a0, blinker
    j    loadPattern
startGlider:
    la   $a0, glider
    j    loadPattern
startBigBlinker:
    la   $a0, bigBlinker
    j    loadPattern
startAcorn:
    la   $a0, acorn
    j    loadPattern

# Bring to life the cells listed in the table at $a0.
loadPattern:
    li   $t2, WIDTH
    li   $t3, FIRST_AGE
loadCell:
    lb   $t0, 0($a0)                # row, or -1 at the end of the table
    bltz $t0, begin
    lb   $t1, 1($a0)                # column
    addi $a0, $a0, 2
    addi $t0, $t0, 1                # the border shifts everything down and right by one
    mul  $t0, $t0, $t2
    add  $t0, $t0, $t1
    addi $t0, $t0, 1                # cell number = (row + 1) * WIDTH + column + 1
    sll  $t0, $t0, 2
    add  $t0, $t0, $s0
    sw   $t3, 0($t0)
    j    loadCell

# ---- Main loop ---------------------------------------------------------------

begin:
    move $a0, $s0
    jal  wrapEdges
    jal  drawAll

generation:
    # Step 1: work out the next grid from the current one, row by row.
    addi $t8, $s0, FIRST_CELL       # this cell in the current grid
    addi $t9, $s1, FIRST_CELL       # this cell in the next grid
    move $a2, $s3                   # this cell's pixel
    move $a3, $s7                   # end of the draw list
    li   $v1, SIZE                  # rows left

row:
    # Start the sliding window: count the live cells in the column to the left
    # of the first cell ($t3) and in the first cell's own column ($t4).
    lw   $t0, UP_LEFT($t8)
    lw   $t1, LEFT($t8)
    lw   $t2, DOWN_LEFT($t8)
    sltu $t0, $zero, $t0            # an age becomes 1 if alive, 0 if dead
    sltu $t1, $zero, $t1
    sltu $t2, $zero, $t2
    add  $t3, $t0, $t1
    add  $t3, $t3, $t2
    lw   $t0, UP($t8)
    lw   $t6, 0($t8)
    lw   $t2, DOWN($t8)
    sltu $t0, $zero, $t0
    sltu $t6, $zero, $t6            # $t6: is this cell alive?
    sltu $t2, $zero, $t2
    add  $t4, $t0, $t6
    add  $t4, $t4, $t2
    addi $t7, $t8, ROW_BYTES        # where this row ends

cell:
    lw   $t0, UP_RIGHT($t8)
    lw   $t1, RIGHT($t8)
    lw   $t2, DOWN_RIGHT($t8)
    sltu $t0, $zero, $t0
    sltu $t1, $zero, $t1            # $t1: is the cell to the right alive?
    sltu $t2, $zero, $t2
    add  $t5, $t0, $t1
    add  $t5, $t5, $t2              # live cells in the column to the right
    add  $a0, $t3, $t4
    add  $a0, $a0, $t5              # live cells in the 3 x 3 block, this cell included

    beq  $a0, $s4, alive            # 3 in the block: a birth, or survival with 2 neighbours
    bne  $a0, $s5, dead             # anything else but 4: dies or stays empty
    beqz $t6, dead                  # 4 in the block is survival only if this cell is one of them

alive:
    lw   $a0, 0($t8)                # age so far (0 for a newborn)
    beq  $a0, $s6, keep             # already the oldest: same colour, nothing to redraw
    addi $a0, $a0, 1
    sll  $v0, $a0, 2
    add  $v0, $v0, $s2
    lw   $v0, 0($v0)                # colour for the new age
    sw   $a2, 0($a3)                # add (pixel, colour) to the draw list
    sw   $v0, 4($a3)
    addi $a3, $a3, 8
keep:
    sw   $a0, 0($t9)
    j    nextCell

dead:
    sw   $zero, 0($t9)
    beqz $t6, nextCell              # it was empty before too: nothing to redraw
    sw   $a2, 0($a3)                # add (pixel, black) to the draw list
    sw   $zero, 4($a3)
    addi $a3, $a3, 8

nextCell:
    move $t3, $t4                   # slide the window one cell to the right
    move $t4, $t5
    move $t6, $t1
    addi $t8, $t8, 4
    addi $t9, $t9, 4
    addi $a2, $a2, 4
    bne  $t8, $t7, cell

    addi $t8, $t8, 8                # step over the two border cells
    addi $t9, $t9, 8
    addi $v1, $v1, -1
    bnez $v1, row

    # Step 2: copy the new grid's edges into its border, ready for next time.
    move $a0, $s1
    jal  wrapEdges

    # Step 3: redraw the pixels that changed.
    move $t0, $s7
    beq  $t0, $a3, swap
redraw:
    lw   $t1, 0($t0)                # pixel address
    lw   $t2, 4($t0)                # colour
    sw   $t2, 0($t1)
    addi $t0, $t0, 8
    bne  $t0, $a3, redraw

    # Step 4: the next grid becomes the current one.
swap:
    move $t0, $s0
    move $s0, $s1
    move $s1, $t0
    j    generation

# ---- Subroutines -------------------------------------------------------------

# Make the grid at $a0 wrap around: fill its border with copies of the opposite edges.
wrapEdges:
    addi $t0, $a0, STRIDE           # left border cell of the first real row
    li   $t1, SIZE
wrapColumns:
    lw   $t2, LAST_COLUMN($t0)
    lw   $t3, RIGHT($t0)            # the first real cell
    sw   $t2, 0($t0)
    sw   $t3, RIGHT_PAD($t0)
    addi $t0, $t0, STRIDE
    addi $t1, $t1, -1
    bnez $t1, wrapColumns

    move $t0, $a0                   # top border row; the corners come along with it
    li   $t1, WIDTH
wrapRows:
    lw   $t2, LAST_ROW($t0)
    lw   $t3, STRIDE($t0)           # the first real row
    sw   $t2, 0($t0)
    sw   $t3, BOTTOM_PAD($t0)
    addi $t0, $t0, 4
    addi $t1, $t1, -1
    bnez $t1, wrapRows
    jr   $ra

# Draw every cell of the current grid.
drawAll:
    addi $t8, $s0, FIRST_CELL
    move $a2, $s3
    li   $t9, SIZE
drawRow:
    addi $t7, $t8, ROW_BYTES
drawCell:
    lw   $t0, 0($t8)                # age
    sll  $t0, $t0, 2
    add  $t0, $t0, $s2
    lw   $t0, 0($t0)                # colour for that age
    sw   $t0, 0($a2)
    addi $t8, $t8, 4
    addi $a2, $a2, 4
    bne  $t8, $t7, drawCell
    addi $t8, $t8, 8                # step over the two border cells
    addi $t9, $t9, -1
    bnez $t9, drawRow
    jr   $ra
