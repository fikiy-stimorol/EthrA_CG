// 1. Define aquí los nombres exactos de tus imágenes (incluyendo .jpg, .png, etc.)
// Asegúrate de que las mayúsculas y minúsculas coincidan con tus archivos reales.
const nombresDeCartas = [
    'carta1.jpg',
    'carta2.jpg',
    'carta3.png',
    'dragon_rojo.jpg',
    'hechizo_fuego.jpg'
    // Añade más nombres aquí separados por comas
];

// 2. Buscamos el contenedor en el HTML donde vamos a poner las cartas
const contenedorGaleria = document.getElementById('galeria-cartas');

// 3. Recorremos la lista de nombres y creamos una imagen para cada uno
nombresDeCartas.forEach(nombreArchivo => {
    // Creamos un elemento <img>
    const img = document.createElement('img');
    
    // Le decimos dónde está la imagen (en la carpeta 'cartas')
    img.src = `cartas/${nombreArchivo}`;
    
    // Le añadimos un texto alternativo (bueno para accesibilidad)
    img.alt = `Imagen de ${nombreArchivo}`;
    
    // Le asignamos la clase CSS que creamos para darle estilo
    img.className = 'carta';
    
    // Finalmente, metemos la imagen dentro del contenedor en la web
    contenedorGaleria.appendChild(img);
});
