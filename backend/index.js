require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const app = express();
app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI;
mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("Connected to MongoDB Atlas");
    initializeMenu(); // Initialize the menu after connecting to the database
  })
  .catch((error) => console.error("Connection error", error.message));

// Mongoose Schemas and Models
const dishSchema = new mongoose.Schema({
  type: { type: String, enum: ["main", "side", "dessert"], required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
});

const Dish = mongoose.model("Dish", dishSchema);

const orderSchema = new mongoose.Schema({
  mainDish: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Dish",
    required: true,
  },
  sideDishes: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Dish",
      required: true,
      //   validate: [arrayLimit, "At least one side dish required"],
    },
  ],
  dessert: { type: mongoose.Schema.Types.ObjectId, ref: "Dish" },
  createdAt: { type: Date, default: Date.now },
});

function arrayLimit(val) {
  return val.length >= 1;
}

const Order = mongoose.model("Order", orderSchema);

app.post("/order", async (req, res) => {
  if (
    !req.body.mainDish ||
    !Array.isArray(req.body.sideDishes) ||
    req.body.sideDishes.length === 0
  ) {
    return res.status(400).json({
      message: "You must order at least one main dish and one side dish.",
    });
  }

  try {
    const mainDish = await Dish.findOne({ name: req.body.mainDish });
    if (!mainDish) {
      return res.status(404).json({ message: "Main dish not found" });
    }

    const sideDishesIds = [];
    for (const sideDishName of req.body.sideDishes) {
      const sideDish = await Dish.findOne({ name: sideDishName });
      if (!sideDish) {
        return res
          .status(404)
          .json({ message: `Side dish ${sideDishName} not found` });
      }
      sideDishesIds.push(sideDish._id);
    }

    let dessertId = null;
    if (req.body.dessert) {
      const dessert = await Dish.findOne({ name: req.body.dessert });
      if (!dessert) {
        return res.status(404).json({ message: "Dessert not found" });
      }
      dessertId = dessert._id;
    }

    const orderData = {
      mainDish: mainDish._id,
      sideDishes: sideDishesIds,
      dessert: dessertId,
    };

    const newOrder = new Order(orderData);
    const order = await newOrder.save();
    res.status(201).json(order);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Read all orders
app.get("/orders", async (req, res) => {
  try {
    const orders = await Order.find().populate("mainDish sideDishes dessert");
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Read a single order
app.get("/order/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate(
      "mainDish sideDishes dessert"
    );
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update order
app.put("/order/:id", async (req, res) => {
  try {
    const { mainDish, sideDishes, dessert } = req.body;

    // Validate if the provided ID is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID format" });
    }

    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      { mainDish, sideDishes, dessert },
      { new: true }
    ).populate("mainDish sideDishes dessert");

    if (!updatedOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json(updatedOrder);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete order
app.delete("/order/:id", async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    console.log("Deleting order with ID:", req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json({ message: "Order deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Report: Daily sales revenue
app.get("/reports/daily-sales", async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    const orders = await Order.find({
      createdAt: { $gte: today, $lt: tomorrow },
    }).populate("mainDish sideDishes dessert");

    const dailySales = orders.reduce((total, order) => {
      total += order.mainDish.price;
      order.sideDishes.forEach((dish) => (total += dish.price));
      if (order.dessert) total += order.dessert.price;
      return total;
    }, 0);

    res.json({ dailySales });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Report: Most famous main dish
app.get("/reports/famous-main-dish", async (req, res) => {
  try {
    const mostFamous = await Order.aggregate([
      { $group: { _id: "$mainDish", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
    ]).exec();

    const dish = await Dish.findById(mostFamous[0]._id);
    res.json({ dish: dish.name, orders: mostFamous[0].count });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Report: Most famous side dish
app.get("/reports/famous-side-dish", async (req, res) => {
  try {
    const mostFamous = await Order.aggregate([
      { $unwind: "$sideDishes" },
      { $group: { _id: "$sideDishes", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
    ]).exec();

    const dish = await Dish.findById(mostFamous[0]._id);
    res.json({ dish: dish.name, orders: mostFamous[0].count });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Report: Which side dish is consumed most with which main dish
app.get("/reports/most-common-pair", async (req, res) => {
  try {
    const mostCommonPair = await Order.aggregate([
      { $unwind: "$sideDishes" },
      {
        $group: {
          _id: { mainDish: "$mainDish", sideDish: "$sideDishes" },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      {
        $lookup: {
          from: Dish.collection.name,
          localField: "_id.mainDish",
          foreignField: "_id",
          as: "mainDishInfo",
        },
      },
      {
        $lookup: {
          from: Dish.collection.name,
          localField: "_id.sideDish",
          foreignField: "_id",
          as: "sideDishInfo",
        },
      },
      { $unwind: "$mainDishInfo" },
      { $unwind: "$sideDishInfo" },
      { $limit: 1 },
    ]);

    if (mostCommonPair.length > 0) {
      const pair = mostCommonPair[0];
      res.json({
        mainDish: pair.mainDishInfo.name,
        sideDish: pair.sideDishInfo.name,
        orders: pair.count,
      });
    } else {
      res.json({ message: "No pairings found" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Menu Endpoints
app.get("/menu/:type", async (req, res) => {
  const { type } = req.params;
  try {
    const dishes = await Dish.find({ type: type });
    console.log(dishes);
    res.json(dishes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Function to initialize the menu
async function initializeMenu() {
  const defaultDishes = [
    { type: "main", name: "Rice", price: 100 },
    { type: "main", name: "Rotty", price: 20 },
    { type: "main", name: "Noodles", price: 150 },
    { type: "side", name: "Wadai", price: 45 },
    { type: "side", name: "Dhal curry", price: 75 },
    { type: "side", name: "Fish curry", price: 120 },
    { type: "dessert", name: "Watalappam", price: 40 },
    { type: "dessert", name: "Jelly", price: 20 },
    { type: "dessert", name: "Pudding", price: 250 },
  ];

  try {
    for (let dish of defaultDishes) {
      const dishExists = await Dish.findOne({ name: dish.name });
      if (!dishExists) {
        const newDish = new Dish(dish);
        await newDish.save();
      }
    }
    console.log("Menu initialized");
  } catch (error) {
    console.error("Error initializing the menu:", error.message);
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
