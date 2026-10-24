import { FRAG_BLUR, FRAG_COMP, FRAG_SIM, VERT } from "./starfield-slider-shaders"

type Target = { buffer: WebGLFramebuffer; texture: WebGLTexture }

/** The unmodified shader pipeline from claude-range-slider (e79b9ac). */
export function createStarfieldRenderer(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("webgl2", { preserveDrawingBuffer: false, antialias: false })
  if (!context) return
  const gl = context
  const programs: WebGLProgram[] = []
  let targets: Target[] = []
  const vertexArray = gl.createVertexArray()
  const vertices = gl.createBuffer()

  function compile(type: number, source: string) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader)
      gl.deleteShader(shader)
      throw new Error(error ?? "Starfield shader compilation failed")
    }
    return shader
  }

  function link(fragment: string) {
    const program = gl.createProgram()!
    programs.push(program)
    const vertexShader = compile(gl.VERTEX_SHADER, VERT)
    try {
      const fragmentShader = compile(gl.FRAGMENT_SHADER, fragment)
      gl.attachShader(program, vertexShader)
      gl.attachShader(program, fragmentShader)
      gl.linkProgram(program)
      gl.deleteShader(fragmentShader)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Starfield shader linking failed")
    } finally {
      gl.deleteShader(vertexShader)
    }
    return program
  }

  function releaseTargets() {
    for (const target of targets) {
      gl.deleteFramebuffer(target.buffer)
      gl.deleteTexture(target.texture)
    }
    targets = []
  }

  function dispose() {
    releaseTargets()
    for (const program of programs) gl.deleteProgram(program)
    gl.deleteVertexArray(vertexArray)
    gl.deleteBuffer(vertices)
  }

  try {
    const simulation = link(FRAG_SIM)
    const blur = link(FRAG_BLUR)
    const composite = link(FRAG_COMP)
    const uniform = (program: WebGLProgram, name: string) => gl.getUniformLocation(program, name)
    const simulationUniforms = {
      time: uniform(simulation, "u_time"), slider: uniform(simulation, "u_slider"),
      elapsed: uniform(simulation, "u_elapsed"), back: uniform(simulation, "u_back"),
    }
    const blurUniforms = {
      resolution: uniform(blur, "u_res"), direction: uniform(blur, "u_dir"),
      extract: uniform(blur, "u_ext"), texture: uniform(blur, "u_tex"),
    }
    const compositeUniforms = {
      scene: uniform(composite, "u_scene"), glow: uniform(composite, "u_glow"),
    }
    gl.bindVertexArray(vertexArray)
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.clearColor(0, 0, 0, 1)

    function createTarget() {
      const buffer = gl.createFramebuffer()!
      const texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.bindFramebuffer(gl.FRAMEBUFFER, buffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      return { buffer, texture }
    }

    return {
      resize(cssWidth: number, height: number) {
        const ratio = window.devicePixelRatio
        const pixelWidth = Math.max(1, Math.round(cssWidth * ratio))
        const pixelHeight = Math.max(1, Math.round(height * ratio))
        if (canvas.width === pixelWidth && canvas.height === pixelHeight && targets.length) return
        releaseTargets()
        canvas.width = pixelWidth
        canvas.height = pixelHeight
        targets = Array.from({ length: 4 }, createTarget)
      },
      clear() {
        for (const target of targets.slice(0, 2)) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.buffer)
          gl.clear(gl.COLOR_BUFFER_BIT)
        }
      },
      draw(time: number, progress: number, elapsed: number) {
        if (targets.length !== 4 || gl.isContextLost()) return
        const [back, scene, horizontal, vertical] = targets
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.bindVertexArray(vertexArray)

        gl.bindFramebuffer(gl.FRAMEBUFFER, scene.buffer)
        gl.useProgram(simulation)
        gl.uniform1f(simulationUniforms.time, time)
        gl.uniform1f(simulationUniforms.slider, progress)
        gl.uniform1f(simulationUniforms.elapsed, elapsed)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, back.texture)
        gl.uniform1i(simulationUniforms.back, 0)
        gl.drawArrays(gl.TRIANGLES, 0, 6)

        gl.useProgram(blur)
        gl.uniform2f(blurUniforms.resolution, canvas.width, canvas.height)
        gl.uniform1i(blurUniforms.texture, 0)
        gl.bindFramebuffer(gl.FRAMEBUFFER, horizontal.buffer)
        gl.uniform2f(blurUniforms.direction, 1, 0)
        gl.uniform1f(blurUniforms.extract, 1)
        gl.bindTexture(gl.TEXTURE_2D, scene.texture)
        gl.drawArrays(gl.TRIANGLES, 0, 6)

        gl.bindFramebuffer(gl.FRAMEBUFFER, vertical.buffer)
        gl.uniform2f(blurUniforms.direction, 0, 1)
        gl.uniform1f(blurUniforms.extract, 0)
        gl.bindTexture(gl.TEXTURE_2D, horizontal.texture)
        gl.drawArrays(gl.TRIANGLES, 0, 6)

        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.useProgram(composite)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, scene.texture)
        gl.uniform1i(compositeUniforms.scene, 0)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, vertical.texture)
        gl.uniform1i(compositeUniforms.glow, 1)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        targets[0] = scene
        targets[1] = back
      },
      dispose,
    }
  } catch (error) {
    dispose()
    console.error("Unable to initialize starfield rendering", error)
  }
}
