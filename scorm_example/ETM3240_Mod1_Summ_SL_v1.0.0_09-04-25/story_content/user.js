window.InitUserScripts = function()
{
var player = GetPlayer();
var object = player.object;
var once = player.once;
var addToTimeline = player.addToTimeline;
var setVar = player.SetVar;
var getVar = player.GetVar;
var update = player.update;
var pointerX = player.pointerX;
var pointerY = player.pointerY;
var showPointer = player.showPointer;
var hidePointer = player.hidePointer;
var slideWidth = player.slideWidth;
var slideHeight = player.slideHeight;
window.Script1 = function()
{
  // Hide the default lightbox close button by ID
var closeBtn = document.getElementById("light-box-close");
if (closeBtn) {
    closeBtn.style.display = "none";
}

// Alternatively, hide by class name (for newer Storyline versions)
var closeBtns = document.getElementsByClassName("lightbox-close-btn-floating");
if (closeBtns.length > 0) {
    closeBtns[0].style.display = "none";
}

}

window.Script2 = function()
{
  // Hide the default lightbox close button by ID
var closeBtn = document.getElementById("light-box-close");
if (closeBtn) {
    closeBtn.style.display = "none";
}

// Alternatively, hide by class name (for newer Storyline versions)
var closeBtns = document.getElementsByClassName("lightbox-close-btn-floating");
if (closeBtns.length > 0) {
    closeBtns[0].style.display = "none";
}

}

window.Script3 = function()
{
  // Hide the default lightbox close button by ID
var closeBtn = document.getElementById("light-box-close");
if (closeBtn) {
    closeBtn.style.display = "none";
}

// Alternatively, hide by class name (for newer Storyline versions)
var closeBtns = document.getElementsByClassName("lightbox-close-btn-floating");
if (closeBtns.length > 0) {
    closeBtns[0].style.display = "none";
}

}

window.Script4 = function()
{
  // Hide the default lightbox close button by ID
var closeBtn = document.getElementById("light-box-close");
if (closeBtn) {
    closeBtn.style.display = "none";
}

// Alternatively, hide by class name (for newer Storyline versions)
var closeBtns = document.getElementsByClassName("lightbox-close-btn-floating");
if (closeBtns.length > 0) {
    closeBtns[0].style.display = "none";
}

}

window.Script5 = function()
{
  // Hide the default lightbox close button by ID
var closeBtn = document.getElementById("light-box-close");
if (closeBtn) {
    closeBtn.style.display = "none";
}

// Alternatively, hide by class name (for newer Storyline versions)
var closeBtns = document.getElementsByClassName("lightbox-close-btn-floating");
if (closeBtns.length > 0) {
    closeBtns[0].style.display = "none";
}

}

};
