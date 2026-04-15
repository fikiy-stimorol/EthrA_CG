// Construimos la URL de la API de GitHub que lee nuestra carpeta
const urlAPI = `https://api.github.com/repos/${usuarioGitHub}/${nombreRepositorio}/contents/cartas`;

// 2. Buscamos el contenedor HTML
const contenedorGaleria = document.getElementById('galeria-cartas');

// 3. Función principal para obtener y mostrar las cartas
async function cargarCartasAutomaticamente() {
    try {
        // Le pedimos a GitHub la lista de archivos en esa carpeta
        const respuesta = await fetch(urlAPI);
        
        // Si hay algún error (ej. pusiste mal el nombre), avisamos
        if (!respuesta.ok) {
            throw new Error("No se pudo acceder a la carpeta en GitHub.");
        }

        const archivos = await respuesta.json();

        // Recorremos la lista de archivos que nos devuelve GitHub
        archivos.forEach(archivo => {
            // Comprobamos que el archivo sea una imagen (por su extensión)
            if (archivo.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                
                // Creamos la imagen en el HTML
                const img = document.createElement('img');
                
                // Usamos la ruta local de la imagen
                img.src = `cartas/${archivo.name}`;
                img.alt = `Carta: ${archivo.name}`;
                img.className = 'carta';
                
                // Añadimos la carta a la galería
                contenedorGaleria.appendChild(img);
            }
        });

    } catch (error) {
        // Si falla, mostramos un mensaje en la web y en la consola
        console.error('Error cargando las cartas:', error);
        contenedorGaleria.innerHTML = `<p>Hubo un error cargando las cartas. Revisa la configuración del script.</p>`;
    }
}

// 4. Ejecutamos la función al cargar la página
cargarCartasAutomaticamente();
